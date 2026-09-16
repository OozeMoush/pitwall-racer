import type { ArcadeCarInput } from './ArcadeCarController';
import {
  MACHINE_PHYSICS_DT,
  machineStateFromVehicle,
  machineStateSpeed,
  stepMachineCar,
  type MachineCarState,
} from './MachineCarIntegrator';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import {
  getActiveTrack,
  projectTrackNear,
  sampleTrack,
  setActiveTrack,
  type TrackId,
  type TrackProjection,
} from './TrackModel';
import { createVehicle } from './VehicleModel';

export interface MachineLapPolicyContext {
  state: MachineCarState;
  projection: TrackProjection;
  elapsedSeconds: number;
  completedLaps: number;
}

export type MachineLapPolicy = (context: MachineLapPolicyContext) => ArcadeCarInput;

export interface MachineLapResult {
  completed: boolean;
  lapSeconds?: number;
  warmupSeconds?: number;
  maxLaneDistance: number;
  illegalSamples: number;
  samples: number;
  maxSpeed: number;
  averageSpeed: number;
  finalState: MachineCarState;
}

export interface MachineLapOptions {
  trackId: TrackId;
  policy: MachineLapPolicy;
  startProgress?: number;
  startLane?: number;
  startSpeed?: number;
  maximumSeconds?: number;
  dt?: number;
  legalLaneLimit?: number;
}

/**
 * Execute a policy through a warm-up crossing and one complete flying lap.
 *
 * This is deliberately not a curvature/time-envelope estimator. Every control
 * command advances x/y, heading, lateral velocity and yaw through the same
 * 120 Hz chassis recurrence as the clean Rapier car. Optimisers can call this
 * cheaply and are judged on the lap the virtual car actually completes.
 */
export function evaluateMachineFlyingLap(options: MachineLapOptions): MachineLapResult {
  const previousTrack = getActiveTrack().id;
  setActiveTrack(options.trackId);

  const dt = options.dt ?? MACHINE_PHYSICS_DT;
  const startProgress = options.startProgress ?? 0.08;
  const startLane = options.startLane ?? 0;
  const startSpeed = options.startSpeed ?? 52;
  const maximumSeconds = options.maximumSeconds ?? 90;
  const legalLaneLimit = options.legalLaneLimit ?? REFERENCE_LANE_LIMIT;
  const pose = sampleTrack(startProgress, startLane);
  let state = machineStateFromVehicle({
    ...createVehicle(pose.x, pose.y, pose.heading),
    speed: startSpeed,
  });
  let projection = projectTrackNear(state.x, state.y, startProgress);
  let previousProgress = projection.progress;
  let completedLaps = 0;
  let firstCrossingSeconds: number | undefined;
  let lapSeconds: number | undefined;
  let maxLaneDistance = projection.distance;
  let illegalSamples = 0;
  let samples = 0;
  let speedSum = 0;
  let maxSpeed = machineStateSpeed(state);

  const maximumTicks = Math.ceil(maximumSeconds / dt);
  for (let tick = 0; tick < maximumTicks; tick++) {
    const elapsedSeconds = tick * dt;
    const input = options.policy({ state, projection, elapsedSeconds, completedLaps });
    state = stepMachineCar(state, input, dt);
    projection = projectTrackNear(state.x, state.y, previousProgress);
    const speed = machineStateSpeed(state);

    maxLaneDistance = Math.max(maxLaneDistance, projection.distance);
    maxSpeed = Math.max(maxSpeed, speed);
    speedSum += speed;
    samples += 1;
    if (projection.distance > legalLaneLimit) illegalSamples += 1;

    const crossedStart = previousProgress > 0.88 && projection.progress < 0.12;
    if (crossedStart) {
      completedLaps += 1;
      const crossingSeconds = (tick + 1) * dt;
      if (firstCrossingSeconds === undefined) {
        firstCrossingSeconds = crossingSeconds;
      } else {
        lapSeconds = crossingSeconds - firstCrossingSeconds;
        break;
      }
    }
    previousProgress = projection.progress;
  }

  if (previousTrack !== options.trackId) setActiveTrack(previousTrack);

  return {
    completed: lapSeconds !== undefined,
    lapSeconds,
    warmupSeconds: firstCrossingSeconds,
    maxLaneDistance,
    illegalSamples,
    samples,
    maxSpeed,
    averageSpeed: speedSum / Math.max(1, samples),
    finalState: state,
  };
}
