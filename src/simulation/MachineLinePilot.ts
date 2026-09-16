import type { ArcadeCarInput } from './ArcadeCarController';
import { dynamicAiControl } from './DynamicAiController';
import type { MachineLapPolicyContext } from './MachineLapEvaluator';
import { predictiveAiSteer } from './PredictiveAiSteering';
import { createAiField, type DriverState } from './RaceModel';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { compoundPeakGrip, createTire } from './TireModel';
import { trackProfile } from './TrackProfile';
import { sampleTrack, TRACK_LENGTH, type TrackId } from './TrackModel';

const POWER_BOOST = 0.22;
const GRIP = compoundPeakGrip('SOFT', 'PUSH');

export interface MachineLinePilotOptions {
  /** Brake multiplier through the 50-72% technical complex. */
  middleBrakeScale?: number;
  /** Brake multiplier through the wrapped 82-6% final/start complex. */
  finalBrakeScale?: number;
}

/**
 * Execute an arbitrary smooth machine-generated lane through the full-state
 * evaluator while keeping the proven clean-air longitudinal controller as the
 * baseline. Optional brake scales are machine-search dimensions: they alter
 * only driver input, never power, grip, tire state, or chassis capability.
 */
export class MachineLinePilot {
  private readonly driver: DriverState;
  private readonly middleBrakeScale: number;
  private readonly finalBrakeScale: number;

  constructor(
    private readonly trackId: TrackId,
    private readonly lanes: readonly number[],
    options: MachineLinePilotOptions = {},
  ) {
    this.middleBrakeScale = clamp(options.middleBrakeScale ?? 1, 0.35, 1.15);
    this.finalBrakeScale = clamp(options.finalBrakeScale ?? 1, 0.35, 1.15);

    this.driver = createAiField()[0];
    this.driver.id = 'machine-line';
    this.driver.name = 'MACHINE';
    this.driver.skill = 1.25; // reference execution clamps to exactly 100%
    this.driver.progress = 0.08;
    this.driver.lap = 0;
    this.driver.laneOffset = 0;
    this.driver.speed = 0;
    this.driver.battleState = 'CLEAR';
    this.driver.tire = {
      ...createTire('SOFT'),
      grip: GRIP,
      wear: 0,
      temperature: 103,
    };
  }

  control(context: MachineLapPolicyContext): ArcadeCarInput {
    const speed = Math.hypot(context.state.vx, context.state.vy);
    this.driver.progress = context.projection.progress;
    this.driver.laneOffset = context.projection.laneOffset;
    this.driver.speed = speed;
    this.driver.lap = context.completedLaps;
    this.driver.battleState = 'CLEAR';

    const base = dynamicAiControl(this.driver, {
      x: context.state.x,
      y: context.state.y,
      heading: context.state.heading,
      speed,
      yawRate: context.state.yawRate,
    }, []);

    const progress = context.projection.progress;
    const profile = trackProfile(progress, 1, GRIP);
    const technicalLookahead = 1 - clamp((profile.severity - 0.58) / 0.42, 0, 1) * 0.22;
    const lookAheadMetres = clamp(18 + speed * 0.32, 28, 60) * technicalLookahead;
    const targetProgress = progress + lookAheadMetres / TRACK_LENGTH;
    const targetLane = clamp(sampleCircular(this.lanes, targetProgress), -REFERENCE_LANE_LIMIT, REFERENCE_LANE_LIMIT);
    const currentLane = clamp(sampleCircular(this.lanes, progress), -REFERENCE_LANE_LIMIT, REFERENCE_LANE_LIMIT);
    const target = sampleTrack(targetProgress, targetLane);
    const tangentProgress = targetProgress + 8 / TRACK_LENGTH;
    const tangentLane = clamp(sampleCircular(this.lanes, tangentProgress), -REFERENCE_LANE_LIMIT, REFERENCE_LANE_LIMIT);
    const tangent = sampleTrack(tangentProgress, tangentLane);

    const pathHeading = Math.atan2(tangent.y - target.y, tangent.x - target.x);
    const bearingHeading = Math.atan2(target.y - context.state.y, target.x - context.state.x);
    const headingError = wrapAngle(pathHeading - context.state.heading);
    const bearingError = wrapAngle(bearingHeading - context.state.heading);
    const lateralError = clamp((currentLane - context.projection.laneOffset) / 9.0, -1, 1);
    const baselineSteer = clamp(
      headingError * 2.15
        + bearingError * 0.82
        + lateralError * 0.52
        - context.state.yawRate * 0.38,
      -0.98,
      0.98,
    );
    const predictionWeight = this.trackId === 'pitwall-gp'
      ? pitwallPredictionWeight(progress, profile.severity)
      : 0;
    const steer = predictiveAiSteer(
      {
        x: context.state.x,
        y: context.state.y,
        heading: context.state.heading,
        speed,
        yawRate: context.state.yawRate,
      },
      GRIP,
      target,
      tangent,
      baselineSteer,
      predictionWeight,
    );

    const brakeScale = this.trackId === 'pitwall-gp'
      ? technicalBrakeScale(progress, this.middleBrakeScale, this.finalBrakeScale)
      : 1;
    const brake = base.brake * brakeScale;

    return {
      // Preserve the baseline throttle request. Reduced braking therefore means
      // later/softer deceleration, not hidden propulsion.
      throttle: brake > 0.06 ? 0 : base.throttle,
      brake,
      steer,
      tireGrip: GRIP,
      surfaceGrip: 1,
      powerBoost: POWER_BOOST,
      powerMultiplier: 1,
      rollingResistance: 0,
    };
  }
}

export function sampleMachineLine(lanes: readonly number[], progress: number): number {
  return sampleCircular(lanes, progress);
}

function technicalBrakeScale(progress: number, middleScale: number, finalScale: number): number {
  const p = wrap01(progress);
  const middle = windowWeight(p, 0.48, 0.73, 0.035);
  const final = Math.max(
    windowWeight(p, 0.82, 1.0, 0.030),
    windowWeight(p, 0.0, 0.065, 0.025),
  );
  let scale = 1;
  scale = lerp(scale, middleScale, middle);
  scale = lerp(scale, finalScale, final);
  return clamp(scale, 0.35, 1.15);
}

function pitwallPredictionWeight(progress: number, severity: number): number {
  const technical = clamp((severity - 0.18) / 0.74, 0, 1);
  const p = wrap01(progress);
  const middle = windowWeight(p, 0.50, 0.68, 0.035);
  const final = Math.max(
    windowWeight(p, 0.835, 0.998, 0.030),
    windowWeight(p, 0.000, 0.045, 0.022),
  );
  return technical * Math.max(middle * 0.32, final * 0.34);
}

function sampleCircular(values: readonly number[], progress: number): number {
  if (values.length === 0) return 0;
  const p = wrap01(progress);
  const scaled = p * values.length;
  const index = Math.floor(scaled) % values.length;
  const next = (index + 1) % values.length;
  const t = scaled - Math.floor(scaled);
  return values[index] + (values[next] - values[index]) * t;
}

function windowWeight(progress: number, start: number, end: number, feather: number): number {
  if (progress >= start && progress <= end) return 1;
  if (progress >= start - feather && progress < start) {
    return smoothstep((progress - (start - feather)) / feather);
  }
  if (progress > end && progress <= end + feather) {
    return 1 - smoothstep((progress - end) / feather);
  }
  return 0;
}

function smoothstep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

function wrapAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
