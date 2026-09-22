import { afterEach, describe, expect, it } from 'vitest';
import { explicitLineFollower } from './ExplicitLineFollower';
import { setRuntimeRacingLine } from './RacingLineRuntime';
import { sampleTrack } from './TrackModel';
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
