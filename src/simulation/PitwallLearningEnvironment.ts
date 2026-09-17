import type { VehicleState } from './VehicleModel';
import { MACHINE_PHYSICS_DT } from './MachineCarIntegrator';
import { RapierRacePhysics, CAR_COLLIDER_HALF_WIDTH } from './RapierRacePhysics';
import { compoundPeakGrip } from './TireModel';
import { surfaceEffect } from './SurfaceModel';
import {
  getActiveTrack,
  projectTrackNear,
  sampleTrack,
  setActiveTrack,
  TRACK_LENGTH,
  type TrackProjection,
} from './TrackModel';
import { TRACK_ROAD_HALF_WIDTH } from './TrackLimitsModel';
import { createVehicle } from './VehicleModel';
import {
  PITWALL_LEARNING_OBSERVATION_SIZE,
  type PitwallLearningAction,
} from './PitwallNeuralPolicy';

const POWER_BOOST = 0.22;
const GRIP = compoundPeakGrip('SOFT', 'PUSH');
const START_PROGRESS = 0.08;
const START_SPEED = 52;
const FULL_CAR_OFFROAD_DISTANCE = TRACK_ROAD_HALF_WIDTH + CAR_COLLIDER_HALF_WIDTH;
const MAX_PLAUSIBLE_PROGRESS_STEP = 0.010;
const MAX_REVERSE_PROGRESS = 0.025;
const LOOKAHEAD_METRES = [12, 25, 45, 70, 100] as const;

export interface PitwallLearningPolicyContext {
  observation: readonly number[];
  state: VehicleState;
  projection: TrackProjection;
  elapsedSeconds: number;
  completedLaps: number;
}

export type PitwallLearningPolicy = (
  context: PitwallLearningPolicyContext,
) => PitwallLearningAction;

export type PitwallLearningStatus = 'COMPLETED' | 'INCOMPLETE' | 'INVALID';
export type PitwallLearningInvalidReason =
  | 'FULL_CAR_OFFROAD'
  | 'IMPOSSIBLE_PROGRESS_JUMP'
  | 'SUSTAINED_REVERSE';

export interface PitwallLearningTraceSample {
  observation: number[];
  action: PitwallLearningAction;
  progress: number;
  laneOffset: number;
  speed: number;
}

export interface PitwallLearningEpisodeResult {
  status: PitwallLearningStatus;
  invalidReason?: PitwallLearningInvalidReason;
  lapSeconds?: number;
  elapsedSeconds: number;
  forwardProgressMetres: number;
  maxLaneDistance: number;
  peakSlideSeverity: number;
  trace: PitwallLearningTraceSample[];
}

export interface PitwallLearningEpisodeOptions {
  maximumSeconds?: number;
  captureFlyingLap?: boolean;
}

/**
 * Authoritative learning environment for Pitwall GP.
 *
 * There is deliberately no off-track reward penalty. Kerb/runoff/grass only
 * affect the car through the game's real SurfaceModel. The episode becomes
 * invalid only when the whole physical car has left the road, progress makes
 * an impossible shortcut jump, or the car meaningfully reverses around the
 * circuit. Valid completed policies are compared by lap time outside this
 * function; incomplete/invalid policies can use forwardProgressMetres only as
 * a curriculum/tie-break signal.
 */
export function evaluatePitwallLearningPolicy(
  policy: PitwallLearningPolicy,
  options: PitwallLearningEpisodeOptions = {},
): PitwallLearningEpisodeResult {
  const previousTrack = getActiveTrack().id;
  setActiveTrack('pitwall-gp');

  try {
    const startPose = sampleTrack(START_PROGRESS, 0);
    const start = {
      ...createVehicle(startPose.x, startPose.y, startPose.heading),
      speed: START_SPEED,
      yawRate: 0,
    };
    const physics = new RapierRacePhysics(start, []);
    physics.setPlayerState(start);

    let projection = projectTrackNear(start.x, start.y, START_PROGRESS);
    let previousProgress = projection.progress;
    let completedLaps = 0;
    let firstCrossing: number | undefined;
    let flyingLap: number | undefined;
    let maxLaneDistance = projection.distance;
    let peakSlideSeverity = 0;
    let netProgress = 0;
    let bestProgress = 0;
    let invalidReason: PitwallLearningInvalidReason | undefined;
    const trace: PitwallLearningTraceSample[] = [];
    const captureFlyingLap = options.captureFlyingLap ?? false;
    const maximumSeconds = options.maximumSeconds ?? 70;
    const maximumTicks = Math.ceil(maximumSeconds / MACHINE_PHYSICS_DT);
    let ticks = 0;

    for (; ticks < maximumTicks; ticks++) {
      const elapsedSeconds = ticks * MACHINE_PHYSICS_DT;
      const state = physics.playerState();
      const observation = pitwallLearningObservation(state, projection);
      const action = sanitizeAction(policy({
        observation,
        state,
        projection,
        elapsedSeconds,
        completedLaps,
      }));

      if (captureFlyingLap && firstCrossing !== undefined) {
        trace.push({
          observation: [...observation],
          action: { ...action },
          progress: projection.progress,
          laneOffset: projection.laneOffset,
          speed: state.speed,
        });
      }

      const surface = surfaceEffect(projection.distance);
      physics.drivePlayer({
        throttle: Math.max(0, action.longitudinal),
        brake: Math.max(0, -action.longitudinal),
        steer: action.steer,
        tireGrip: GRIP,
        tireWear: 0,
        surfaceGrip: surface.gripMultiplier,
        powerBoost: POWER_BOOST,
        powerMultiplier: surface.powerMultiplier,
        rollingResistance: surface.rollingResistance,
      }, MACHINE_PHYSICS_DT);
      physics.step(MACHINE_PHYSICS_DT);
      peakSlideSeverity = Math.max(peakSlideSeverity, physics.playerSlideSeverity());

      const next = physics.playerState();
      const nextProjection = projectTrackNear(next.x, next.y, previousProgress);
      maxLaneDistance = Math.max(maxLaneDistance, nextProjection.distance);

      if (nextProjection.distance > FULL_CAR_OFFROAD_DISTANCE) {
        invalidReason = 'FULL_CAR_OFFROAD';
        projection = nextProjection;
        break;
      }

      const delta = signedProgressDelta(previousProgress, nextProjection.progress);
      if (Math.abs(delta) > MAX_PLAUSIBLE_PROGRESS_STEP) {
        invalidReason = 'IMPOSSIBLE_PROGRESS_JUMP';
        projection = nextProjection;
        break;
      }
      netProgress += delta;
      bestProgress = Math.max(bestProgress, netProgress);
      if (netProgress < bestProgress - MAX_REVERSE_PROGRESS) {
        invalidReason = 'SUSTAINED_REVERSE';
        projection = nextProjection;
        break;
      }

      const crossedStart = previousProgress > 0.88 && nextProjection.progress < 0.12;
      if (crossedStart) {
        completedLaps += 1;
        const crossing = (ticks + 1) * MACHINE_PHYSICS_DT;
        if (firstCrossing === undefined) {
          firstCrossing = crossing;
        } else {
          flyingLap = crossing - firstCrossing;
          projection = nextProjection;
          ticks += 1;
          break;
        }
      }

      previousProgress = nextProjection.progress;
      projection = nextProjection;
    }

    const elapsedSeconds = ticks * MACHINE_PHYSICS_DT;
    return {
      status: invalidReason
        ? 'INVALID'
        : flyingLap !== undefined
          ? 'COMPLETED'
          : 'INCOMPLETE',
      invalidReason,
      lapSeconds: flyingLap,
      elapsedSeconds,
      forwardProgressMetres: Math.max(0, bestProgress * TRACK_LENGTH),
      maxLaneDistance,
      peakSlideSeverity,
      trace,
    };
  } finally {
    setActiveTrack(previousTrack);
  }
}

export function pitwallLearningObservation(
  state: VehicleState,
  projection: TrackProjection,
): number[] {
  const headingError = wrapAngle(state.heading - projection.heading);
  const progressAngle = projection.progress * Math.PI * 2;
  const observation = [
    state.speed / 110,
    state.yawRate / 1.45,
    projection.laneOffset / TRACK_ROAD_HALF_WIDTH,
    Math.sin(headingError),
    Math.cos(headingError),
    Math.sin(progressAngle),
    Math.cos(progressAngle),
    ...LOOKAHEAD_METRES.map((metres) => aheadTurn(projection.progress, metres)),
  ];

  if (observation.length !== PITWALL_LEARNING_OBSERVATION_SIZE) {
    throw new Error(`Learning observation size mismatch: ${observation.length}`);
  }
  return observation;
}

/**
 * Compare episode results without inventing a numeric off-track penalty.
 * Completed valid laps dominate everything and are ordered solely by lap time.
 * Incomplete episodes dominate invalid ones and are ordered by forward progress.
 */
export function comparePitwallLearningResults(
  a: PitwallLearningEpisodeResult,
  b: PitwallLearningEpisodeResult,
): number {
  const tier = (result: PitwallLearningEpisodeResult) => result.status === 'COMPLETED'
    ? 2
    : result.status === 'INCOMPLETE'
      ? 1
      : 0;
  const tierDelta = tier(b) - tier(a);
  if (tierDelta !== 0) return tierDelta;
  if (a.status === 'COMPLETED' && b.status === 'COMPLETED') {
    return (a.lapSeconds ?? Infinity) - (b.lapSeconds ?? Infinity);
  }
  return b.forwardProgressMetres - a.forwardProgressMetres;
}

function aheadTurn(progress: number, metres: number): number {
  const here = sampleTrack(progress, 0);
  const ahead = sampleTrack(progress + metres / Math.max(1, TRACK_LENGTH), 0);
  return clamp(wrapAngle(ahead.heading - here.heading) / (Math.PI / 2), -1, 1);
}

function signedProgressDelta(previous: number, next: number): number {
  let delta = next - previous;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
}

function sanitizeAction(action: PitwallLearningAction): PitwallLearningAction {
  return {
    steer: clamp(Number.isFinite(action.steer) ? action.steer : 0, -1, 1),
    longitudinal: clamp(Number.isFinite(action.longitudinal) ? action.longitudinal : 0, -1, 1),
  };
}

function wrapAngle(angle: number): number {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
