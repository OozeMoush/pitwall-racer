import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { MACHINE_PHYSICS_DT } from './MachineCarIntegrator';
import {
  createPitwallAbsolutePilot,
  createPitwallAbsoluteSeed,
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

describe('Pitwall absolute machine pilot in Rapier', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('replays the current ReferenceDriver-independent machine seed in the actual rigid-body world', () => {
    const previousTrack = getActiveTrack().id;
    setActiveTrack('pitwall-gp');
    try {
      installReferenceLineCalibration();
      const genome = createPitwallAbsoluteSeed();
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

      const maximumTicks = Math.ceil(60 / MACHINE_PHYSICS_DT);
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

      console.log('PITWALL_ABSOLUTE_RAPIER', JSON.stringify({
        centralSpeedLift: genome.centralSpeedLift,
        speedDeltas: genome.speedDeltas,
        predictionScale: genome.predictionScale,
        lookAheadScale: genome.lookAheadScale,
        speedFeedback: genome.speedFeedback,
        completed: flyingLap !== undefined,
        seconds: flyingLap === undefined ? null : Number(flyingLap.toFixed(3)),
        maxLaneDistance: Number(maxLaneDistance.toFixed(3)),
        maxLaneProgress: Number(maxLaneProgress.toFixed(4)),
        maxLaneOffset: Number(maxLaneOffset.toFixed(3)),
        illegalSamples,
        peakSlideSeverity: Number(peakSlideSeverity.toFixed(3)),
      }));

      expect(flyingLap).toBeDefined();
      expect(illegalSamples).toBe(0);
      expect(maxLaneDistance).toBeLessThanOrEqual(REFERENCE_LANE_LIMIT);
      expect(peakSlideSeverity).toBe(0);
      expect(flyingLap!).toBeLessThanOrEqual(25.575 + 1e-9);
    } finally {
      setActiveTrack(previousTrack);
    }
  }, 15_000);
});
