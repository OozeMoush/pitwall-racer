import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { CAR_COLLIDER_HALF_LENGTH, RapierRacePhysics } from './RapierRacePhysics';
import {
  TRACK_BARRIER_OFFSET,
  hasSafetyBarrier,
} from './TrackLimitsModel';
import { projectTrack, sampleTrack } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;

describe('physical safety barriers', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('leaves only narrow physical doors at pit entry and exit', () => {
    expect(hasSafetyBarrier(0.50, 1)).toBe(true);
    expect(hasSafetyBarrier(0.50, -1)).toBe(true);
    expect(hasSafetyBarrier(0.91, 1)).toBe(false);
    expect(hasSafetyBarrier(0.07, 1)).toBe(false);
    expect(hasSafetyBarrier(0.95, 1)).toBe(true);
    expect(hasSafetyBarrier(0.02, 1)).toBe(true);
    expect(hasSafetyBarrier(0.91, -1)).toBe(true);
  });

  it('stops a high-speed car from crossing the outside wall', () => {
    const progress = 0.50;
    const startLane = TRACK_BARRIER_OFFSET - CAR_COLLIDER_HALF_LENGTH - 2;
    const track = sampleTrack(progress, startLane);
    const outwardHeading = track.heading + Math.PI / 2;
    const physics = new RapierRacePhysics(
      { ...createVehicle(track.x, track.y, outwardHeading), speed: 70 },
      [],
    );

    for (let tick = 0; tick < 1.2 / DT; tick++) physics.step(DT);

    const state = physics.playerState();
    const projection = projectTrack(state.x, state.y);
    expect(projection.distance).toBeLessThan(TRACK_BARRIER_OFFSET + 3);
    expect(state.speed).toBeLessThan(45);
  });
});
