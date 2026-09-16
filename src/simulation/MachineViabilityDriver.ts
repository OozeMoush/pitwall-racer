import type { ArcadeCarInput } from './ArcadeCarController';
import {
  MACHINE_PHYSICS_DT,
  machineStateSpeed,
  stepMachineCar,
  type MachineCarState,
} from './MachineCarIntegrator';
import type { MachineLapPolicyContext } from './MachineLapEvaluator';
import { referenceTarget, REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { compoundPeakGrip } from './TireModel';
import { projectTrackNear, sampleTrack, TRACK_LENGTH, type TrackId } from './TrackModel';

const POWER_BOOST = 0.22;
const GRIP = compoundPeakGrip('SOFT', 'PUSH');
const DECISION_TICKS = 12; // 0.10 s
const RESCUE_TICKS = 204; // 1.70 s beyond the committed action
const LEGAL_MARGIN = 0.20;

interface PedalAction {
  throttle: number;
  brake: number;
}

const PEDAL_CANDIDATES: readonly PedalAction[] = [
  { throttle: 1, brake: 0 },
  { throttle: 0.55, brake: 0 },
  { throttle: 0, brake: 0 },
  { throttle: 0, brake: 0.30 },
  { throttle: 0, brake: 0.58 },
  { throttle: 0, brake: 0.90 },
];

/**
 * Machine-only longitudinal search on the current generated line.
 *
 * This is intentionally a simpler experiment than the discarded short-horizon
 * MPC. Steering remains closed-loop to the machine-generated lane, while each
 * 100 ms pedal choice asks a physical question: after committing to this pedal
 * input, can the same chassis still rescue itself with hard braking for the
 * next 1.7 seconds without leaving the legal corridor?
 *
 * The first feasible action in acceleration order is chosen. No analytical
 * target-speed table and no human telemetry participate. This gives us a clean
 * diagnostic of whether the existing line is capable of much more pace once
 * the old quasi-static speed envelope is removed.
 */
export class MachineViabilityDriver {
  private pedal: PedalAction = PEDAL_CANDIDATES[0];
  private lastDecisionTick = -DECISION_TICKS;

  constructor(private readonly trackId: TrackId) {}

  control(context: MachineLapPolicyContext): ArcadeCarInput {
    const tick = Math.max(0, Math.round(context.elapsedSeconds / MACHINE_PHYSICS_DT));
    if (tick - this.lastDecisionTick >= DECISION_TICKS) {
      this.pedal = choosePedal(context.state, context.projection.progress, this.trackId);
      this.lastDecisionTick = tick;
    }

    return physicalInput(
      this.pedal,
      geometricSteer(context.state, context.projection.progress, this.trackId),
    );
  }
}

function choosePedal(state: MachineCarState, progress: number, trackId: TrackId): PedalAction {
  for (const candidate of PEDAL_CANDIDATES) {
    if (canRemainLegalAfterCommit(state, progress, trackId, candidate)) return candidate;
  }
  return PEDAL_CANDIDATES[PEDAL_CANDIDATES.length - 1];
}

function canRemainLegalAfterCommit(
  initialState: MachineCarState,
  initialProgress: number,
  trackId: TrackId,
  candidate: PedalAction,
): boolean {
  let state = initialState;
  let progress = initialProgress;
  let previousUnwrapped = initialProgress;
  const laneLimit = REFERENCE_LANE_LIMIT - LEGAL_MARGIN;

  for (let tick = 0; tick < DECISION_TICKS + RESCUE_TICKS; tick++) {
    const pedal = tick < DECISION_TICKS
      ? candidate
      : { throttle: 0, brake: rescueBrake(tick - DECISION_TICKS) };
    const steer = geometricSteer(state, progress, trackId);
    state = stepMachineCar(state, physicalInput(pedal, steer), MACHINE_PHYSICS_DT);
    const projection = projectTrackNear(state.x, state.y, progress);

    if (projection.distance > laneLimit) return false;
    if (machineStateSpeed(state) < 4 && tick > DECISION_TICKS + 60) return true;

    const unwrapped = unwrapForward(projection.progress, previousUnwrapped);
    if (unwrapped < previousUnwrapped - 0.004) return false;
    previousUnwrapped = unwrapped;
    progress = projection.progress;
  }

  return true;
}

function rescueBrake(tick: number): number {
  // A real optimum may trail-brake, but the viability proof is deliberately
  // conservative: once the candidate's 100 ms commitment ends, allow strong
  // braking immediately so current acceleration is accepted only when there is
  // still a physically reachable legal future.
  if (tick < 24) return 0.72;
  return 0.95;
}

function geometricSteer(state: MachineCarState, progress: number, trackId: TrackId): number {
  const speed = machineStateSpeed(state);
  const lookAheadMetres = clamp(18 + speed * 0.27, 24, 50);
  const targetProgress = progress + lookAheadMetres / TRACK_LENGTH;
  const targetLane = clamp(
    referenceTarget(trackId, targetProgress, GRIP).laneOffset,
    -REFERENCE_LANE_LIMIT,
    REFERENCE_LANE_LIMIT,
  );
  const target = sampleTrack(targetProgress, targetLane);
  const tangentProgress = targetProgress + 7 / TRACK_LENGTH;
  const tangentLane = clamp(
    referenceTarget(trackId, tangentProgress, GRIP).laneOffset,
    -REFERENCE_LANE_LIMIT,
    REFERENCE_LANE_LIMIT,
  );
  const tangent = sampleTrack(tangentProgress, tangentLane);

  const pathHeading = Math.atan2(tangent.y - target.y, tangent.x - target.x);
  const bearing = Math.atan2(target.y - state.y, target.x - state.x);
  const headingError = wrapAngle(pathHeading - state.heading);
  const bearingError = wrapAngle(bearing - state.heading);
  return clamp(
    headingError * 2.15 + bearingError * 0.92 - state.yawRate * 0.38,
    -0.98,
    0.98,
  );
}

function physicalInput(pedal: PedalAction, steer: number): ArcadeCarInput {
  return {
    throttle: pedal.throttle,
    brake: pedal.brake,
    steer,
    tireGrip: GRIP,
    surfaceGrip: 1,
    powerBoost: POWER_BOOST,
    powerMultiplier: 1,
    rollingResistance: 0,
  };
}

function unwrapForward(progress: number, previousUnwrapped: number): number {
  const previousWrapped = ((previousUnwrapped % 1) + 1) % 1;
  let delta = progress - previousWrapped;
  if (delta < -0.5) delta += 1;
  if (delta > 0.5) delta -= 1;
  return previousUnwrapped + delta;
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
