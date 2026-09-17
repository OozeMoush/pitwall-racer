import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { MACHINE_PHYSICS_DT } from './MachineCarIntegrator';
import {
  createPitwallJointPilot,
  createPitwallJointSeed,
} from './PitwallJointOptimizer';
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

const SPEED_TRACE_BINS = 32;

describe('Pitwall machine reference in Rapier', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('replays the baked machine seed through the actual rigid-body world', () => {
    const previousTrack = getActiveTrack().id;
    setActiveTrack('pitwall-gp');
    try {
      installReferenceLineCalibration();
      const pilot = createPitwallJointPilot(
        OPTIMIZED_REFERENCE_LANES['pitwall-gp'],
        createPitwallJointSeed(),
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
      const speedSums = Array.from({ length: SPEED_TRACE_BINS }, () => 0);
      const speedCounts = Array.from({ length: SPEED_TRACE_BINS }, () => 0);
      const speedMins = Array.from({ length: SPEED_TRACE_BINS }, () => Number.POSITIVE_INFINITY);
      const speedMaxes = Array.from({ length: SPEED_TRACE_BINS }, () => 0);

      const maximumTicks = Math.ceil(60 / MACHINE_PHYSICS_DT);
      for (let tick = 0; tick < maximumTicks; tick++) {
        const state = physics.playerState();
        const speed = state.speed;
        if (completedLaps === 1) {
          const bin = Math.min(
            SPEED_TRACE_BINS - 1,
            Math.floor(projection.progress * SPEED_TRACE_BINS),
          );
          speedSums[bin] += speed;
          speedCounts[bin] += 1;
          speedMins[bin] = Math.min(speedMins[bin], speed);
          speedMaxes[bin] = Math.max(speedMaxes[bin], speed);
        }
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

      const speedTrace = speedSums.map((sum, index) => ({
        p: Number(((index + 0.5) / SPEED_TRACE_BINS).toFixed(4)),
        avg: speedCounts[index] === 0 ? null : Number((sum / speedCounts[index]).toFixed(3)),
        min: speedCounts[index] === 0 ? null : Number(speedMins[index].toFixed(3)),
        max: speedCounts[index] === 0 ? null : Number(speedMaxes[index].toFixed(3)),
      }));

      console.log('PITWALL_RAPIER_MACHINE_REFERENCE', JSON.stringify({
        completed: flyingLap !== undefined,
        seconds: flyingLap === undefined ? null : Number(flyingLap.toFixed(3)),
        maxLaneDistance: Number(maxLaneDistance.toFixed(3)),
        maxLaneProgress: Number(maxLaneProgress.toFixed(4)),
        maxLaneOffset: Number(maxLaneOffset.toFixed(3)),
        illegalSamples,
        peakSlideSeverity: Number(peakSlideSeverity.toFixed(3)),
        speedTrace,
      }));

      expect(flyingLap).toBeDefined();
      expect(illegalSamples).toBe(0);
      expect(maxLaneDistance).toBeLessThanOrEqual(REFERENCE_LANE_LIMIT);
      expect(peakSlideSeverity).toBe(0);
      expect(speedCounts.every((count) => count > 0)).toBe(true);
    } finally {
      setActiveTrack(previousTrack);
    }
  }, 15_000);
});
