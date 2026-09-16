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
const DECISION_TICKS = 6;
const STAGE_TICKS = 24;
const STAGES = 3;
const BEAM_WIDTH = 4;

interface CandidateAction {
  throttle: number;
  brake: number;
  steer: number;
}

interface BeamNode {
  state: MachineCarState;
  progress: number;
  score: number;
  firstAction: CandidateAction;
}

/**
 * Receding-horizon machine driver used by the offline executable optimiser.
 *
 * It does not read a human lap and it does not read the analytical reference
 * speed envelope. Every decision is made by rolling the shared chassis forward
 * and asking which legal candidate actually advances furthest around the track.
 * The existing baked line is currently only a weak lane/heading prior; later
 * optimisation can replace that prior without changing this evaluator.
 */
export class MachineMpcDriver {
  private heldAction: CandidateAction = { throttle: 1, brake: 0, steer: 0 };
  private lastDecisionTick = -DECISION_TICKS;

  constructor(private readonly trackId: TrackId) {}

  control(context: MachineLapPolicyContext): ArcadeCarInput {
    const tick = Math.max(0, Math.round(context.elapsedSeconds / MACHINE_PHYSICS_DT));
    if (tick - this.lastDecisionTick >= DECISION_TICKS) {
      this.heldAction = this.chooseAction(context.state, context.projection.progress);
      this.lastDecisionTick = tick;
    }

    return {
      ...this.heldAction,
      tireGrip: GRIP,
      surfaceGrip: 1,
      powerBoost: POWER_BOOST,
      powerMultiplier: 1,
      rollingResistance: 0,
    };
  }

  private chooseAction(rootState: MachineCarState, rootProgress: number): CandidateAction {
    let beam: BeamNode[] = [];

    const firstActions = actionCandidates(rootState, rootProgress, this.trackId);
    for (const action of firstActions) {
      const rolled = rollout(rootState, action, STAGE_TICKS);
      const projection = projectTrackNear(rolled.x, rolled.y, rootProgress);
      beam.push({
        state: rolled,
        progress: projection.progress,
        score: scoreState(rolled, projection.progress, projection.distance, rootProgress, this.trackId),
        firstAction: action,
      });
    }
    beam = keepBest(beam, BEAM_WIDTH);

    for (let stage = 1; stage < STAGES; stage++) {
      const expanded: BeamNode[] = [];
      for (const node of beam) {
        for (const action of actionCandidates(node.state, node.progress, this.trackId)) {
          const rolled = rollout(node.state, action, STAGE_TICKS);
          const projection = projectTrackNear(rolled.x, rolled.y, node.progress);
          expanded.push({
            state: rolled,
            progress: projection.progress,
            score: scoreState(
              rolled,
              projection.progress,
              projection.distance,
              rootProgress,
              this.trackId,
            ),
            firstAction: node.firstAction,
          });
        }
      }
      beam = keepBest(expanded, BEAM_WIDTH);
    }

    return beam[0]?.firstAction ?? { throttle: 1, brake: 0, steer: 0 };
  }
}

function actionCandidates(state: MachineCarState, progress: number, trackId: TrackId): CandidateAction[] {
  const baseline = geometricSteer(state, progress, trackId);
  const steerCandidates = unique([
    baseline - 0.46,
    baseline - 0.22,
    baseline,
    baseline + 0.22,
    baseline + 0.46,
  ].map((value) => clamp(value, -1, 1)));
  const pedals = [
    { throttle: 1, brake: 0 },
    { throttle: 0.35, brake: 0 },
    { throttle: 0, brake: 0 },
    { throttle: 0, brake: 0.42 },
    { throttle: 0, brake: 0.82 },
  ] as const;

  const actions: CandidateAction[] = [];
  for (const steer of steerCandidates) {
    for (const pedal of pedals) actions.push({ ...pedal, steer });
  }
  return actions;
}

function geometricSteer(state: MachineCarState, progress: number, trackId: TrackId): number {
  const speed = machineStateSpeed(state);
  const lookAhead = clamp(22 + speed * 0.30, 30, 58);
  const targetProgress = progress + lookAhead / TRACK_LENGTH;
  const targetLane = clamp(referenceTarget(trackId, targetProgress, GRIP).laneOffset, -REFERENCE_LANE_LIMIT, REFERENCE_LANE_LIMIT);
  const target = sampleTrack(targetProgress, targetLane);
  const tangentProgress = targetProgress + 9 / TRACK_LENGTH;
  const tangentLane = clamp(referenceTarget(trackId, tangentProgress, GRIP).laneOffset, -REFERENCE_LANE_LIMIT, REFERENCE_LANE_LIMIT);
  const tangent = sampleTrack(tangentProgress, tangentLane);
  const pathHeading = Math.atan2(tangent.y - target.y, tangent.x - target.x);
  const bearing = Math.atan2(target.y - state.y, target.x - state.x);
  const headingError = wrapAngle(pathHeading - state.heading);
  const bearingError = wrapAngle(bearing - state.heading);
  return clamp(headingError * 2.0 + bearingError * 0.95 - state.yawRate * 0.34, -1, 1);
}

function rollout(state: MachineCarState, action: CandidateAction, ticks: number): MachineCarState {
  let current = state;
  const input: ArcadeCarInput = {
    ...action,
    tireGrip: GRIP,
    surfaceGrip: 1,
    powerBoost: POWER_BOOST,
    powerMultiplier: 1,
    rollingResistance: 0,
  };
  for (let tick = 0; tick < ticks; tick++) current = stepMachineCar(current, input, MACHINE_PHYSICS_DT);
  return current;
}

function scoreState(
  state: MachineCarState,
  progress: number,
  distance: number,
  rootProgress: number,
  trackId: TrackId,
): number {
  const gain = forwardProgress(progress, rootProgress) * TRACK_LENGTH;
  const speed = machineStateSpeed(state);
  const projectionTarget = referenceTarget(trackId, progress, GRIP);
  const lane = sampleTrack(progress, projectionTarget.laneOffset);
  const laneError = Math.hypot(state.x - lane.x, state.y - lane.y);
  const trackHeading = sampleTrack(progress).heading;
  const headingError = Math.abs(wrapAngle(trackHeading - state.heading));
  const margin = REFERENCE_LANE_LIMIT - distance;
  const illegalPenalty = margin < 0
    ? 6000 + Math.abs(margin) * 1200
    : margin < 1.5
      ? Math.pow(1.5 - margin, 2) * 42
      : 0;
  const backwardsPenalty = gain < -1 ? 5000 + Math.abs(gain) * 250 : 0;

  // Progress dominates. The line prior is deliberately weak: it stabilises the
  // first search before trajectory optimisation, but the MPC may depart from it
  // when the full-state rollout finds a faster legal path.
  return -gain * 6.0
    - speed * 0.10
    + laneError * 0.20
    + headingError * 5.0
    + illegalPenalty
    + backwardsPenalty;
}

function keepBest(nodes: BeamNode[], count: number): BeamNode[] {
  nodes.sort((a, b) => a.score - b.score);
  return nodes.slice(0, count);
}

function forwardProgress(progress: number, origin: number): number {
  let delta = progress - origin;
  if (delta < -0.5) delta += 1;
  else if (delta > 0.5) delta -= 1;
  return delta;
}

function unique(values: readonly number[]): number[] {
  const result: number[] = [];
  for (const value of values) {
    if (!result.some((existing) => Math.abs(existing - value) < 0.02)) result.push(value);
  }
  return result;
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
