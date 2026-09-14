import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { CAR_COLLIDER_HALF_LENGTH, RapierRacePhysics } from './RapierRacePhysics';
import {
  TRACK_BARRIER_OFFSET,
  hasSafetyBarrier,
  shouldPlaceSafetyBarrier,
} from './TrackLimitsModel';
import { projectTrack, sampleTrack } from './TrackModel';
import { trackProfile } from './TrackProfile';
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
    expectWallStopsOutwardCar(0.50, 1);
  });

  it('physically closes the old pit-side shortcut after pit entry', () => {
    expect(hasSafetyBarrier(0.95, 1)).toBe(true);
    expectWallStopsOutwardCar(0.95, 1);
  });

  it('keeps a real inside wall through the tightest chicane-style turn', () => {
    let bestProgress = 0;
    let bestSeverity = -1;
    let bestTurn = 0;
    for (let index = 0; index < 240; index++) {
      const progress = index / 240;
      const profile = trackProfile(progress);
      if (profile.severity > bestSeverity && Math.abs(profile.signedTurn) > 0.025) {
        bestProgress = progress;
        bestSeverity = profile.severity;
        bestTurn = profile.signedTurn;
      }
    }

    const inside = Math.sign(bestTurn) as -1 | 1;
    expect(bestSeverity).toBeGreaterThan(0.72);
    expect(shouldPlaceSafetyBarrier(bestProgress, inside, bestTurn, bestSeverity)).toBe(true);
    expectWallStopsOutwardCar(bestProgress, inside);
  });
});

function expectWallStopsOutwardCar(progress: number, side: -1 | 1): void {
  const startLane = side * (TRACK_BARRIER_OFFSET - CAR_COLLIDER_HALF_LENGTH - 2);
  const track = sampleTrack(progress, startLane);
  const outwardHeading = track.heading + side * Math.PI / 2;
  const physics = new RapierRacePhysics(
    { ...createVehicle(track.x, track.y, outwardHeading), speed: 70 },
    [],
  );

  for (let tick = 0; tick < 1.2 / DT; tick++) physics.step(DT);

  const state = physics.playerState();
  const projection = projectTrack(state.x, state.y);
  expect(projection.distance).toBeLessThan(TRACK_BARRIER_OFFSET + 3);
  expect(state.speed).toBeLessThan(45);
}
