import { MACHINE_PHYSICS_DT } from './MachineCarIntegrator';
import {
  createPitwallAbsolutePilot,
  type PitwallAbsoluteGenome,
} from './PitwallAbsoluteOptimizer';
import { RapierRacePhysics } from './RapierRacePhysics';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';
import {
  getActiveTrack,
  projectTrackNear,
  sampleTrack,
  setActiveTrack,
} from './TrackModel';
import { createVehicle } from './VehicleModel';

export interface PitwallAbsoluteRapierResult {
  completed: boolean;
  lapSeconds?: number;
  maxLaneDistance: number;
  maxLaneProgress: number;
  maxLaneOffset: number;
  illegalSamples: number;
  peakSlideSeverity: number;
}

/**
 * Replay one Pitwall absolute genome through the actual Rapier rigid-body world.
 * Callers must initialize @dimforge/rapier2d-compat once before invoking this.
 * This is the authority for promotion of machine-search proposals near a
 * closed-loop stability boundary.
 */
export function evaluatePitwallAbsoluteRapier(
  genome: PitwallAbsoluteGenome,
  maximumSeconds = 60,
): PitwallAbsoluteRapierResult {
  const previousTrack = getActiveTrack().id;
  setActiveTrack('pitwall-gp');
  try {
    installReferenceLineCalibration();
    const pilot = createPitwallAbsolutePilot(
      OPTIMIZED_REFERENCE_LANES['pitwall-gp'],
      genome,
    );
    const startPose = sampleTrack(0.08, 0);
    const start = {
      ...createVehicle(startPose.x, startPose.y, startPose.heading),
      speed: 52,
      yawRate: 0,
    };
    const physics = new RapierRacePhysics(start, []);
    physics.setPlayerState(start);

    let projection = projectTrackNear(start.x, start.y, 0.08);
    let previousProgress = projection.progress;
    let completedLaps = 0;
    let firstCrossing: number | undefined;
    let flyingLap: number | undefined;
    let maxLaneDistance = projection.distance;
    let maxLaneProgress = projection.progress;
    let maxLaneOffset = projection.laneOffset;
    let illegalSamples = 0;
    let peakSlideSeverity = 0;

    const maximumTicks = Math.ceil(maximumSeconds / MACHINE_PHYSICS_DT);
    for (let tick = 0; tick < maximumTicks; tick++) {
      const state = physics.playerState();
      const speed = state.speed;
      const input = pilot.control({
        state: {
          x: state.x,
          y: state.y,
          heading: state.heading,
          vx: Math.cos(state.heading) * speed,
          vy: Math.sin(state.heading) * speed,
          yawRate: state.yawRate,
        },
        projection,
        elapsedSeconds: tick * MACHINE_PHYSICS_DT,
        completedLaps,
      });

      physics.drivePlayer({ ...input, tireWear: 0 }, MACHINE_PHYSICS_DT);
      physics.step(MACHINE_PHYSICS_DT);
      peakSlideSeverity = Math.max(peakSlideSeverity, physics.playerSlideSeverity());

      const next = physics.playerState();
      projection = projectTrackNear(next.x, next.y, previousProgress);
      if (projection.distance > maxLaneDistance) {
        maxLaneDistance = projection.distance;
        maxLaneProgress = projection.progress;
        maxLaneOffset = projection.laneOffset;
      }
      if (projection.distance > REFERENCE_LANE_LIMIT) illegalSamples += 1;

      const crossedStart = previousProgress > 0.88 && projection.progress < 0.12;
      if (crossedStart) {
        completedLaps += 1;
        const crossing = (tick + 1) * MACHINE_PHYSICS_DT;
        if (firstCrossing === undefined) firstCrossing = crossing;
        else {
          flyingLap = crossing - firstCrossing;
          break;
        }
      }
      previousProgress = projection.progress;
    }

    return {
      completed: flyingLap !== undefined,
      lapSeconds: flyingLap,
      maxLaneDistance,
      maxLaneProgress,
      maxLaneOffset,
      illegalSamples,
      peakSlideSeverity,
    };
  } finally {
    setActiveTrack(previousTrack);
  }
}
