import { afterEach, describe, expect, it } from 'vitest';
import { explicitLineFollower } from './ExplicitLineFollower';
import { setRuntimeRacingLine } from './RacingLineRuntime';
import { sampleTrack, TRACK_LENGTH } from './TrackModel';
import { createVehicle } from './VehicleModel';

afterEach(() => {
  setRuntimeRacingLine('pitwall-gp', undefined);
});

describe('explicitLineFollower', () => {
  it('commands a strong correction toward an edge-hugging PLAYER line', () => {
    const grip = 1.1;
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 160 }, (_, index) => ({
        progress: index / 160,
        laneOffset: 10,
        targetSpeed: 64,
      })),
    });

    const progress = 0.08;
    const pose = sampleTrack(progress, 5);
    const vehicle = {
      ...createVehicle(pose.x, pose.y, pose.heading),
      speed: 64,
    };

    const target = explicitLineFollower('pitwall-gp', vehicle, progress, grip);
    expect(target.laneError).toBeGreaterThan(4);
    expect(target.steer).toBeGreaterThan(0.2);
    // Error recovery still looks far enough ahead to avoid chasing a single
    // point; the important regression is decisive steering back to the path.
    expect(target.lookAheadMetres).toBeLessThan(22);
  });

  it('anticipates an upcoming demonstrated yaw unwind before an S-bend overshoot', () => {
    const grip = 1.1;
    const progress = 0.08;
    const transition = progress + 5 / TRACK_LENGTH;
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 640 }, (_, index) => {
        const pointProgress = index / 640;
        return {
          progress: pointProgress,
          laneOffset: 0,
          targetSpeed: 32,
          headingOffset: 0,
          yawRate: pointProgress < transition ? -1.2 : -0.1,
        };
      }),
    });

    const pose = sampleTrack(progress, 0);
    const vehicle = {
      ...createVehicle(pose.x, pose.y, pose.heading),
      speed: 32,
      yawRate: -1.2,
    };

    const target = explicitLineFollower('pitwall-gp', vehicle, progress, grip);
    expect(target.demonstratedDynamics).toBe(true);
    expect(target.targetYawRate).toBeDefined();
    expect(target.targetYawRate!).toBeGreaterThan(-1.05);
  });

  it('reverses the correction when the car is outside the explicit line', () => {
    const grip = 1.1;
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 160 }, (_, index) => ({
        progress: index / 160,
        laneOffset: 4,
        targetSpeed: 60,
      })),
    });

    const progress = 0.08;
    const pose = sampleTrack(progress, 9);
    const vehicle = {
      ...createVehicle(pose.x, pose.y, pose.heading),
      speed: 60,
    };

    const target = explicitLineFollower('pitwall-gp', vehicle, progress, grip);
    expect(target.laneError).toBeLessThan(-4);
    expect(target.steer).toBeLessThan(-0.2);
  });
});
