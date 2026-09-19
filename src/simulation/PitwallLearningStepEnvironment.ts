import type { VehicleState } from './VehicleModel';
import { MACHINE_PHYSICS_DT } from './MachineCarIntegrator';
import {
  RapierRacePhysics,
  CAR_COLLIDER_HALF_LENGTH,
  CAR_COLLIDER_HALF_WIDTH,
  type PlanarVelocity,
} from './RapierRacePhysics';
import { compoundPeakGrip } from './TireModel';
import { surfaceEffect } from './SurfaceModel';
import {
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
const MAX_PLAUSIBLE_PROGRESS_STEP = 0.010;
const MAX_REVERSE_PROGRESS = 0.025;
const LOOKAHEAD_METRES = [12, 25, 45, 70, 100] as const;
const PROGRESS_HARMONICS = [1, 2, 4] as const;

/**
 * Positive constant scaling only. It does not change which trajectory is
 * optimal; it keeps SAC critic targets in a numerically convenient range.
 */
export const PITWALL_RL_REWARD_METRES_SCALE = 1;

export type PitwallLearningStatus = 'COMPLETED' | 'INCOMPLETE' | 'INVALID';
export type PitwallLearningInvalidReason =
  | 'FULL_CAR_OFFROAD'
  | 'IMPOSSIBLE_PROGRESS_JUMP'
  | 'SUSTAINED_REVERSE';

export interface PitwallLearningPolicyContext {
  observation: readonly number[];
  state: VehicleState;
  projection: TrackProjection;
  elapsedSeconds: number;
  completedLaps: number;
}

export interface PitwallLearningTraceSample {
  observation: number[];
  action: PitwallLearningAction;
  elapsedSeconds: number;
  progress: number;
  laneOffset: number;
  x: number;
  y: number;
  heading: number;
  speed: number;
  yawRate: number;
  vx: number;
  vy: number;
  slideSeverity: number;
}

export interface PitwallLearningEpisodeResult {
  status: PitwallLearningStatus;
  invalidReason?: PitwallLearningInvalidReason;
  /** Game-equivalent 120 Hz flying-lap time. */
  lapSeconds?: number;
  /** Sub-tick interpolation used only inside the same game-time bucket. */
  preciseLapSeconds?: number;
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

export interface PitwallLearningResetOptions {
  startProgress?: number;
  startSpeed?: number;
  /**
   * Training-only curriculum termination. When set, the episode ends after
   * this much net forward progress without redefining an official flying lap.
   */
  completionProgressLaps?: number;
}

export interface PitwallLearningTransition {
  context: PitwallLearningPolicyContext;
  reward: number;
  terminated: boolean;
  truncated: boolean;
  result?: PitwallLearningEpisodeResult;
  trainingLapCompleted?: boolean;
}

/**
 * Stepwise form of the authoritative Pitwall learning environment.
 *
 * The agent owns steer/throttle/brake directly. There is no target racing line,
 * target speed, corner window or off-track reward coefficient. A valid step is
 * rewarded only for signed forward physical progress. Discounting therefore
 * makes faster progress preferable without encoding where or how to drive.
 *
 * Kerb/runoff/grass remain purely physical through SurfaceModel. Whole-car
 * circuit departure, impossible progress jumps and sustained reverse are hard
 * terminal validity rules.
 */
export class PitwallLearningStepEnvironment {
  private physics!: RapierRacePhysics;
  private projection!: TrackProjection;
  private previousProgress = START_PROGRESS;
  private completedLaps = 0;
  private firstCrossing: number | undefined;
  private firstPreciseCrossing: number | undefined;
  private flyingLap: number | undefined;
  private preciseFlyingLap: number | undefined;
  private maxLaneDistance = 0;
  private peakSlideSeverity = 0;
  private netProgress = 0;
  private bestProgress = 0;
  private invalidReason: PitwallLearningInvalidReason | undefined;
  private trace: PitwallLearningTraceSample[] = [];
  private ticks = 0;
  private done = false;
  private completionProgressLaps: number | undefined;
  private readonly captureFlyingLap: boolean;
  private readonly maximumTicks: number;

  constructor(options: PitwallLearningEpisodeOptions = {}) {
    this.captureFlyingLap = options.captureFlyingLap ?? false;
    this.maximumTicks = Math.ceil(
      (options.maximumSeconds ?? 70) / MACHINE_PHYSICS_DT,
    );
    this.reset();
  }

  reset(
    options: PitwallLearningResetOptions = {},
  ): PitwallLearningPolicyContext {
    setActiveTrack('pitwall-gp');
    const startProgress = wrapProgress(
      options.startProgress ?? START_PROGRESS,
    );
    const startSpeed = options.startSpeed ?? START_SPEED;
    const startPose = sampleTrack(startProgress, 0);
    const start = {
      ...createVehicle(startPose.x, startPose.y, startPose.heading),
      speed: startSpeed,
      yawRate: 0,
    };
    this.physics = new RapierRacePhysics(start, []);
    this.physics.setPlayerState(start);

    this.projection = projectTrackNear(
      start.x,
      start.y,
      startProgress,
    );
    this.previousProgress = this.projection.progress;
    this.completedLaps = 0;
    this.firstCrossing = undefined;
    this.firstPreciseCrossing = undefined;
    this.flyingLap = undefined;
    this.preciseFlyingLap = undefined;
    this.maxLaneDistance = this.projection.distance;
    this.peakSlideSeverity = 0;
    this.netProgress = 0;
    this.bestProgress = 0;
    this.invalidReason = undefined;
    this.trace = [];
    this.ticks = 0;
    this.done = false;
    this.completionProgressLaps =
      options.completionProgressLaps === undefined
        ? undefined
        : Math.max(0, options.completionProgressLaps);

    return this.context();
  }

  context(): PitwallLearningPolicyContext {
    const state = this.physics.playerState();
    const velocity = this.physics.playerVelocity();
    const slideSeverity = this.physics.playerSlideSeverity();
    return {
      observation: pitwallLearningObservation(
        state,
        this.projection,
        velocity,
        slideSeverity,
      ),
      state,
      projection: this.projection,
      elapsedSeconds: this.ticks * MACHINE_PHYSICS_DT,
      completedLaps: this.completedLaps,
    };
  }

  step(rawAction: PitwallLearningAction): PitwallLearningTransition {
    if (this.done) {
      throw new Error('Pitwall learning episode is done; call reset() before step()');
    }

    const context = this.context();
    const action = sanitizeAction(rawAction);
    const velocity = this.physics.playerVelocity();
    const slideSeverity = this.physics.playerSlideSeverity();

    if (this.captureFlyingLap && this.firstCrossing !== undefined) {
      this.trace.push({
        observation: [...context.observation],
        action: { ...action },
        elapsedSeconds: context.elapsedSeconds,
        progress: this.projection.progress,
        laneOffset: this.projection.laneOffset,
        x: context.state.x,
        y: context.state.y,
        heading: context.state.heading,
        speed: context.state.speed,
        yawRate: context.state.yawRate,
        vx: velocity.vx,
        vy: velocity.vy,
        slideSeverity,
      });
    }

    const surface = surfaceEffect(this.projection.distance);
    this.physics.drivePlayer({
      throttle: action.throttle,
      brake: action.brake,
      steer: action.steer,
      tireGrip: GRIP,
      tireWear: 0,
      surfaceGrip: surface.gripMultiplier,
      powerBoost: POWER_BOOST,
      powerMultiplier: surface.powerMultiplier,
      rollingResistance: surface.rollingResistance,
    }, MACHINE_PHYSICS_DT);
    this.physics.step(MACHINE_PHYSICS_DT);
    this.peakSlideSeverity = Math.max(
      this.peakSlideSeverity,
      this.physics.playerSlideSeverity(),
    );

    const next = this.physics.playerState();
    const nextProjection = projectTrackNear(
      next.x,
      next.y,
      this.previousProgress,
    );
    this.maxLaneDistance = Math.max(
      this.maxLaneDistance,
      nextProjection.distance,
    );

    const nextHeadingError = wrapAngle(
      next.heading - nextProjection.heading,
    );
    const lateralSupportRadius =
      Math.abs(Math.sin(nextHeadingError)) * CAR_COLLIDER_HALF_LENGTH
      + Math.abs(Math.cos(nextHeadingError)) * CAR_COLLIDER_HALF_WIDTH;

    if (
      nextProjection.distance
      > TRACK_ROAD_HALF_WIDTH + lateralSupportRadius
    ) {
      this.invalidReason = 'FULL_CAR_OFFROAD';
      this.projection = nextProjection;
      this.done = true;
      return this.terminalTransition(0, true, false);
    }

    const delta = signedProgressDelta(
      this.previousProgress,
      nextProjection.progress,
    );
    if (Math.abs(delta) > MAX_PLAUSIBLE_PROGRESS_STEP) {
      this.invalidReason = 'IMPOSSIBLE_PROGRESS_JUMP';
      this.projection = nextProjection;
      this.done = true;
      return this.terminalTransition(0, true, false);
    }

    this.netProgress += delta;
    this.bestProgress = Math.max(this.bestProgress, this.netProgress);
    if (this.netProgress < this.bestProgress - MAX_REVERSE_PROGRESS) {
      this.invalidReason = 'SUSTAINED_REVERSE';
      this.projection = nextProjection;
      this.done = true;
      return this.terminalTransition(0, true, false);
    }

    const reward =
      delta * TRACK_LENGTH * PITWALL_RL_REWARD_METRES_SCALE;

    if (
      this.completionProgressLaps !== undefined
      && this.netProgress >= this.completionProgressLaps
    ) {
      this.projection = nextProjection;
      this.previousProgress = nextProjection.progress;
      this.ticks += 1;
      this.done = true;
      const transition = this.terminalTransition(
        reward,
        true,
        false,
      );
      transition.trainingLapCompleted = true;
      return transition;
    }

    const crossedStart =
      this.previousProgress > 0.88 && nextProjection.progress < 0.12;

    if (crossedStart) {
      this.completedLaps += 1;
      const crossing = (this.ticks + 1) * MACHINE_PHYSICS_DT;
      const crossingFraction = startCrossingFraction(
        this.previousProgress,
        delta,
      );
      const preciseCrossing =
        (this.ticks + crossingFraction) * MACHINE_PHYSICS_DT;

      if (this.firstCrossing === undefined) {
        this.firstCrossing = crossing;
        this.firstPreciseCrossing = preciseCrossing;
      } else {
        this.flyingLap = crossing - this.firstCrossing;
        this.preciseFlyingLap = this.firstPreciseCrossing === undefined
          ? this.flyingLap
          : preciseCrossing - this.firstPreciseCrossing;
        this.projection = nextProjection;
        this.previousProgress = nextProjection.progress;
        this.ticks += 1;
        this.done = true;
        return this.terminalTransition(reward, true, false);
      }
    }

    this.previousProgress = nextProjection.progress;
    this.projection = nextProjection;
    this.ticks += 1;

    if (this.ticks >= this.maximumTicks) {
      this.done = true;
      return this.terminalTransition(reward, false, true);
    }

    return {
      context: this.context(),
      reward,
      terminated: false,
      truncated: false,
    };
  }

  private terminalTransition(
    reward: number,
    terminated: boolean,
    truncated: boolean,
  ): PitwallLearningTransition {
    return {
      context: this.context(),
      reward,
      terminated,
      truncated,
      result: this.result(),
    };
  }

  private result(): PitwallLearningEpisodeResult {
    return {
      status: this.invalidReason
        ? 'INVALID'
        : this.flyingLap !== undefined
          ? 'COMPLETED'
          : 'INCOMPLETE',
      invalidReason: this.invalidReason,
      lapSeconds: this.flyingLap,
      preciseLapSeconds: this.preciseFlyingLap,
      elapsedSeconds: this.ticks * MACHINE_PHYSICS_DT,
      forwardProgressMetres: Math.max(0, this.bestProgress * TRACK_LENGTH),
      maxLaneDistance: this.maxLaneDistance,
      peakSlideSeverity: this.peakSlideSeverity,
      trace: this.trace,
    };
  }
}

export function pitwallLearningObservation(
  state: VehicleState,
  projection: TrackProjection,
  velocity: PlanarVelocity,
  slideSeverity: number,
): number[] {
  const headingError = wrapAngle(state.heading - projection.heading);
  const progressAngle = projection.progress * Math.PI * 2;
  const cosHeading = Math.cos(state.heading);
  const sinHeading = Math.sin(state.heading);
  const forwardSpeed =
    velocity.vx * cosHeading + velocity.vy * sinHeading;
  const lateralSpeed =
    -velocity.vx * sinHeading + velocity.vy * cosHeading;
  const progressFeatures = PROGRESS_HARMONICS.flatMap((harmonic) => [
    Math.sin(progressAngle * harmonic),
    Math.cos(progressAngle * harmonic),
  ]);

  const observation = [
    forwardSpeed / 110,
    lateralSpeed / 50,
    state.yawRate / 1.45,
    projection.laneOffset / TRACK_ROAD_HALF_WIDTH,
    Math.sin(headingError),
    Math.cos(headingError),
    ...progressFeatures,
    ...LOOKAHEAD_METRES.map((metres) =>
      aheadTurn(projection.progress, metres)),
    clamp(slideSeverity, 0, 1),
  ];

  if (observation.length !== PITWALL_LEARNING_OBSERVATION_SIZE) {
    throw new Error(
      `Learning observation size mismatch: ${observation.length}`,
    );
  }
  return observation;
}

function aheadTurn(progress: number, metres: number): number {
  const here = sampleTrack(progress, 0);
  const ahead = sampleTrack(
    progress + metres / Math.max(1, TRACK_LENGTH),
    0,
  );
  return clamp(
    wrapAngle(ahead.heading - here.heading) / (Math.PI / 2),
    -1,
    1,
  );
}

function startCrossingFraction(
  previousProgress: number,
  signedDelta: number,
): number {
  if (!(signedDelta > 0)) return 1;
  return clamp((1 - previousProgress) / signedDelta, 0, 1);
}

function signedProgressDelta(previous: number, next: number): number {
  let delta = next - previous;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
}

function sanitizeAction(
  action: PitwallLearningAction,
): PitwallLearningAction {
  return {
    steer: clamp(
      Number.isFinite(action.steer) ? action.steer : 0,
      -1,
      1,
    ),
    throttle: clamp(
      Number.isFinite(action.throttle) ? action.throttle : 0,
      0,
      1,
    ),
    brake: clamp(
      Number.isFinite(action.brake) ? action.brake : 0,
      0,
      1,
    ),
  };
}

function wrapProgress(progress: number): number {
  return ((progress % 1) + 1) % 1;
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
