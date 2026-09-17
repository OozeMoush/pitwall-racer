import { controlArcadeCar, type ArcadeCarInput } from './ArcadeCarController';
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
const SPEED_OVERRIDE_EPSILON = 1e-4;
const CONTROL_DT = 1 / 120;
// RapierRacePhysics uses 0.018 linear damping after the arcade controller has
// written velocity. Add its first-order loss to the requested controller
// acceleration so the absolute profile is solved against the complete chassis.
const RAPIER_LINEAR_DAMPING = 0.018;

export interface MachineBrakeWindow {
  center: number;
  halfWidth: number;
  scale: number;
}

export interface MachineSpeedWindow {
  center: number;
  halfWidth: number;
  scale: number;
}

export interface MachineSteeringTuning {
  lookAheadScale?: number;
  headingGainScale?: number;
  bearingGainScale?: number;
  lateralGainScale?: number;
  yawDampingScale?: number;
  predictionScale?: number;
  tangentScale?: number;
}

export interface MachineLinePilotOptions extends MachineSteeringTuning {
  /** Brake multiplier through the 50-72% technical complex. */
  middleBrakeScale?: number;
  /** Brake multiplier through the wrapped 82-6% final/start complex. */
  finalBrakeScale?: number;
  /** Local smooth brake-input modifications discovered by full-lap search. */
  brakeWindows?: readonly MachineBrakeWindow[];
  /** Local target-speed multipliers used by course-specific joint optimization. */
  speedWindows?: readonly MachineSpeedWindow[];
  /**
   * Circular absolute speed profile in metres/second. When present, longitudinal
   * control is derived only from this profile and the physical car state; the
   * legacy ReferenceDriver target-speed / planned-brake trace is not consulted.
   */
  absoluteSpeedProfile?: readonly number[];
}

/**
 * Execute an arbitrary smooth machine-generated lane through the full-state
 * evaluator while keeping the proven clean-air controller as the fallback seed.
 * Tuning dimensions alter only driver inputs/targets; power, grip, tyre state
 * and chassis capability stay identical to the player car.
 */
export class MachineLinePilot {
  private readonly driver: DriverState;
  private readonly middleBrakeScale: number;
  private readonly finalBrakeScale: number;
  private readonly brakeWindows: readonly MachineBrakeWindow[];
  private readonly speedWindows: readonly MachineSpeedWindow[];
  private readonly absoluteSpeedProfile?: readonly number[];
  private readonly steering: Required<MachineSteeringTuning>;

  constructor(
    private readonly trackId: TrackId,
    private readonly lanes: readonly number[],
    options: MachineLinePilotOptions = {},
  ) {
    this.middleBrakeScale = clamp(options.middleBrakeScale ?? 1, 0.35, 1.15);
    this.finalBrakeScale = clamp(options.finalBrakeScale ?? 1, 0.35, 1.15);
    this.brakeWindows = options.brakeWindows ?? [];
    this.speedWindows = options.speedWindows ?? [];
    this.absoluteSpeedProfile = options.absoluteSpeedProfile && options.absoluteSpeedProfile.length > 1
      ? [...options.absoluteSpeedProfile]
      : undefined;
    this.steering = {
      lookAheadScale: clamp(options.lookAheadScale ?? 1, 0.65, 1.40),
      headingGainScale: clamp(options.headingGainScale ?? 1, 0.55, 1.55),
      bearingGainScale: clamp(options.bearingGainScale ?? 1, 0.40, 1.75),
      lateralGainScale: clamp(options.lateralGainScale ?? 1, 0.35, 1.85),
      yawDampingScale: clamp(options.yawDampingScale ?? 1, 0.45, 1.70),
      predictionScale: clamp(options.predictionScale ?? 1, 0, 2.0),
      tangentScale: clamp(options.tangentScale ?? 1, 0.60, 1.60),
    };

    this.driver = createAiField()[0];
    this.driver.id = 'machine-line';
    this.driver.name = 'MACHINE';
    this.driver.skill = 1.25;
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

    // The absolute-profile path intentionally skips dynamicAiControl so it has
    // no longitudinal dependency on ReferenceDriverModel. The legacy controller
    // remains as a fallback for older search/regression slices.
    const base = this.absoluteSpeedProfile === undefined
      ? dynamicAiControl(this.driver, {
        x: context.state.x,
        y: context.state.y,
        heading: context.state.heading,
        speed,
        yawRate: context.state.yawRate,
      }, [])
      : undefined;

    const progress = context.projection.progress;
    const profile = trackProfile(progress, 1, GRIP);
    const technicalLookahead = 1 - clamp((profile.severity - 0.58) / 0.42, 0, 1) * 0.22;
    const lookAheadMetres = clamp(18 + speed * 0.32, 28, 60)
      * technicalLookahead
      * this.steering.lookAheadScale;
    const targetProgress = progress + lookAheadMetres / TRACK_LENGTH;
    const targetLane = clamp(sampleCircular(this.lanes, targetProgress), -REFERENCE_LANE_LIMIT, REFERENCE_LANE_LIMIT);
    const currentLane = clamp(sampleCircular(this.lanes, progress), -REFERENCE_LANE_LIMIT, REFERENCE_LANE_LIMIT);
    const target = sampleTrack(targetProgress, targetLane);
    const tangentProgress = targetProgress + 8 * this.steering.tangentScale / TRACK_LENGTH;
    const tangentLane = clamp(sampleCircular(this.lanes, tangentProgress), -REFERENCE_LANE_LIMIT, REFERENCE_LANE_LIMIT);
    const tangent = sampleTrack(tangentProgress, tangentLane);

    const pathHeading = Math.atan2(tangent.y - target.y, tangent.x - target.x);
    const bearingHeading = Math.atan2(target.y - context.state.y, target.x - context.state.x);
    const headingError = wrapAngle(pathHeading - context.state.heading);
    const bearingError = wrapAngle(bearingHeading - context.state.heading);
    const lateralError = clamp((currentLane - context.projection.laneOffset) / 9.0, -1, 1);
    const baselineSteer = clamp(
      headingError * 2.15 * this.steering.headingGainScale
        + bearingError * 0.82 * this.steering.bearingGainScale
        + lateralError * 0.52 * this.steering.lateralGainScale
        - context.state.yawRate * 0.38 * this.steering.yawDampingScale,
      -0.98,
      0.98,
    );
    const predictionWeight = this.trackId === 'pitwall-gp'
      ? pitwallPredictionWeight(progress, profile.severity) * this.steering.predictionScale
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

    let brakeScale = this.trackId === 'pitwall-gp'
      ? technicalBrakeScale(progress, this.middleBrakeScale, this.finalBrakeScale)
      : 1;
    for (const window of this.brakeWindows) {
      const weight = circularWindowWeight(progress, window.center, window.halfWidth);
      if (weight <= 0) continue;
      brakeScale = lerp(brakeScale, clamp(window.scale, 0.25, 1.20), weight);
    }

    const speedScale = speedWindowScale(this.speedWindows, progress);

    if (this.absoluteSpeedProfile !== undefined) {
      const targetSpeed = clamp(sampleCircular(this.absoluteSpeedProfile, progress) * speedScale, 18, 136);
      const profileStep = 1 / this.absoluteSpeedProfile.length;
      const nextProgress = progress + profileStep;
      const nextScale = speedWindowScale(this.speedWindows, nextProgress);
      const nextTargetSpeed = clamp(
        sampleCircular(this.absoluteSpeedProfile, nextProgress) * nextScale,
        18,
        136,
      );
      const nodeDistance = TRACK_LENGTH * profileStep;
      const profileAcceleration = (
        nextTargetSpeed * nextTargetSpeed - targetSpeed * targetSpeed
      ) / Math.max(1, 2 * nodeDistance);
      const feedbackAcceleration = clamp((targetSpeed - speed) * 1.75, -9.0, 9.0);
      // controlArcadeCar reports acceleration before Rapier damping. Compensate
      // for that known post-step loss so the requested *net* acceleration follows
      // the measured executable speed profile rather than a hand-tuned preview.
      const desiredControllerAcceleration = profileAcceleration
        + feedbackAcceleration
        + speed * RAPIER_LINEAR_DAMPING;

      const motion = {
        vx: context.state.vx,
        vy: context.state.vy,
        heading: context.state.heading,
        angularVelocity: context.state.yawRate,
      };
      const common = {
        steer,
        tireGrip: GRIP,
        surfaceGrip: 1,
        powerBoost: POWER_BOOST,
        powerMultiplier: 1,
        rollingResistance: 0,
      };
      const coastAcceleration = controlArcadeCar(
        motion,
        { ...common, throttle: 0, brake: 0 },
        CONTROL_DT,
      ).acceleration;
      const fullThrottleAcceleration = controlArcadeCar(
        motion,
        { ...common, throttle: 1, brake: 0 },
        CONTROL_DT,
      ).acceleration;
      const fullBrakeAcceleration = controlArcadeCar(
        motion,
        { ...common, throttle: 0, brake: 1 },
        CONTROL_DT,
      ).acceleration;

      let throttle = 0;
      let brake = 0;
      if (desiredControllerAcceleration >= coastAcceleration) {
        throttle = clamp(
          (desiredControllerAcceleration - coastAcceleration)
            / Math.max(0.001, fullThrottleAcceleration - coastAcceleration),
          0,
          1,
        );
      } else {
        brake = clamp(
          (coastAcceleration - desiredControllerAcceleration)
            / Math.max(0.001, coastAcceleration - fullBrakeAcceleration),
          0,
          1,
        ) * brakeScale;
      }

      return {
        throttle,
        brake,
        steer,
        tireGrip: GRIP,
        surfaceGrip: 1,
        powerBoost: POWER_BOOST,
        powerMultiplier: 1,
        rollingResistance: 0,
      };
    }

    if (!base) throw new Error('legacy machine pilot requires a base controller');

    // Preserve the proven longitudinal seed exactly unless the course-specific
    // optimizer actually asks for a different target speed at this progress.
    // This keeps a neutral speed genome from silently changing the baseline.
    let brake = base.brake * brakeScale;
    let throttle = brake > 0.06 ? 0 : base.throttle;

    if (Math.abs(speedScale - 1) > SPEED_OVERRIDE_EPSILON) {
      const targetSpeed = base.targetSpeed * speedScale;
      const speedError = targetSpeed - speed;
      if (speedError < -0.45) {
        brake = Math.max(brake, clamp((-speedError - 0.45) / 8.5, 0, 1));
      } else if (speedError > 0.65) {
        const release = clamp(speedError / 5.0, 0, 0.72);
        brake *= 1 - release;
      }

      if (brake > 0.06) throttle = 0;
      else if (speedError > 0.45) throttle = 1;
      else if (speedError < -0.55) throttle *= clamp(1 + speedError / 3.5, 0, 1);
    }

    return {
      throttle,
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

function speedWindowScale(windows: readonly MachineSpeedWindow[], progress: number): number {
  let scale = 1;
  for (const window of windows) {
    const weight = circularWindowWeight(progress, window.center, window.halfWidth);
    if (weight <= 0) continue;
    scale *= lerp(1, clamp(window.scale, 0.86, 1.14), weight);
  }
  return scale;
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

function circularWindowWeight(progress: number, center: number, halfWidth: number): number {
  const distance = Math.abs(circularDelta(wrap01(progress), wrap01(center)));
  if (distance >= halfWidth) return 0;
  const phase = distance / halfWidth;
  return 0.5 * (1 + Math.cos(Math.PI * phase));
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

function circularDelta(a: number, b: number): number {
  let delta = a - b;
  while (delta > 0.5) delta -= 1;
  while (delta < -0.5) delta += 1;
  return delta;
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
