import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { MACHINE_PHYSICS_DT } from './MachineCarIntegrator';
import { MachineLinePilot, type MachineBrakeWindow, type MachineSpeedWindow } from './MachineLinePilot';
import { createPitwallJointSeed, materializePitwallJointLine } from './PitwallJointOptimizer';
import { RapierRacePhysics } from './RapierRacePhysics';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';
import { getActiveTrack, projectTrackNear, sampleTrack, setActiveTrack } from './TrackModel';
import { createVehicle } from './VehicleModel';

const TRACE_NODES = 64;
const SPEED_CENTERS = [0.48, 0.52, 0.56, 0.60, 0.64, 0.88, 0.92, 0.96, 0.00, 0.04] as const;
const BRAKE_CENTERS = [0.50, 0.56, 0.88, 0.94, 0.01] as const;

describe('Pitwall legacy machine speed trace', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('captures instantaneous speed and control at fixed progress nodes from the last legal controller', () => {
    const previousTrack = getActiveTrack().id;
    setActiveTrack('pitwall-gp');
    try {
      installReferenceLineCalibration();
      const seed = createPitwallJointSeed();
      const lanes = materializePitwallJointLine(
        OPTIMIZED_REFERENCE_LANES['pitwall-gp'],
        seed,
      );
      const brakeWindows: MachineBrakeWindow[] = BRAKE_CENTERS.map((center, index) => ({
        center,
        halfWidth: index < 2 ? 0.010 : 0.016,
        scale: seed.brakeScales[index] ?? 1,
      }));
      const speedWindows: MachineSpeedWindow[] = SPEED_CENTERS.map((center, index) => ({
        center,
        halfWidth: 0.022,
        scale: seed.speedScales[index] ?? 1,
      }));
      const pilot = new MachineLinePilot('pitwall-gp', lanes, {
        brakeWindows,
        speedWindows,
        predictionScale: seed.predictionScale,
        lookAheadScale: seed.lookAheadScale,
      });

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
      let illegalSamples = 0;
      const nearestDistances = Array.from({ length: TRACE_NODES }, () => Number.POSITIVE_INFINITY);
      const nodeSpeeds = Array.from({ length: TRACE_NODES }, () => Number.NaN);
      const nodeThrottles = Array.from({ length: TRACE_NODES }, () => Number.NaN);
      const nodeBrakes = Array.from({ length: TRACE_NODES }, () => Number.NaN);

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

        if (completedLaps === 1) {
          const nearestIndex = Math.round(projection.progress * TRACE_NODES) % TRACE_NODES;
          const nodeProgress = nearestIndex / TRACE_NODES;
          const distance = Math.abs(circularDelta(projection.progress, nodeProgress));
          if (distance < nearestDistances[nearestIndex]) {
            nearestDistances[nearestIndex] = distance;
            nodeSpeeds[nearestIndex] = speed;
            nodeThrottles[nearestIndex] = input.throttle;
            nodeBrakes[nearestIndex] = input.brake;
          }
        }

        physics.drivePlayer({ ...input, tireWear: 0 }, MACHINE_PHYSICS_DT);
        physics.step(MACHINE_PHYSICS_DT);
        const next = physics.playerState();
        projection = projectTrackNear(next.x, next.y, previousProgress);
        maxLaneDistance = Math.max(maxLaneDistance, projection.distance);
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

      const nodes = nodeSpeeds.map((speed, index) => ({
        p: Number((index / TRACE_NODES).toFixed(6)),
        speed: Number(speed.toFixed(4)),
        throttle: Number(nodeThrottles[index].toFixed(4)),
        brake: Number(nodeBrakes[index].toFixed(4)),
        progressError: Number(nearestDistances[index].toFixed(6)),
      }));
      console.log('PITWALL_LEGACY_INSTANT_TRACE', JSON.stringify({
        seconds: flyingLap === undefined ? null : Number(flyingLap.toFixed(3)),
        maxLaneDistance: Number(maxLaneDistance.toFixed(3)),
        illegalSamples,
        nodes,
      }));

      expect(flyingLap).toBeDefined();
      expect(flyingLap!).toBeLessThanOrEqual(25.72);
      expect(illegalSamples).toBe(0);
      expect(maxLaneDistance).toBeLessThanOrEqual(REFERENCE_LANE_LIMIT);
      expect(nodeSpeeds.every(Number.isFinite)).toBe(true);
    } finally {
      setActiveTrack(previousTrack);
    }
  }, 15_000);
});

function circularDelta(a: number, b: number): number {
  let delta = a - b;
  while (delta > 0.5) delta -= 1;
  while (delta < -0.5) delta += 1;
  return delta;
}
