import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  barrierNormalSpeed,
  CAR_COLLIDER_HALF_LENGTH,
  isSignificantBarrierImpact,
  RapierRacePhysics,
  WALL_CONTACT_MIN_INCIDENCE_SIN,
  WALL_CONTACT_MIN_NORMAL_SPEED,
} from './RapierRacePhysics';
import {
  TRACK_BARRIER_HALF_THICKNESS,
  TRACK_BARRIER_OFFSET,
  TRACK_KERB_OUTER_OFFSET,
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

  it('does not classify a shallow wall/kerb brush as a wall-impact trace failure', () => {
    const speed = 80;
    const shallowAngle = 0.04;
    const vx = Math.cos(shallowAngle) * speed;
    const vy = Math.sin(shallowAngle) * speed;

    expect(barrierNormalSpeed(vx, vy, 0)).toBeLessThan(
      WALL_CONTACT_MIN_NORMAL_SPEED,
    );
    expect(isSignificantBarrierImpact(vx, vy, 0)).toBe(false);
  });

  it('allows a high-speed shallow wall brush even when lateral speed is non-trivial', () => {
    const speed = 100;
    const shallowAngle = 0.10;
    const vx = Math.cos(shallowAngle) * speed;
    const vy = Math.sin(shallowAngle) * speed;
    const normalSpeed = barrierNormalSpeed(vx, vy, 0);

    expect(normalSpeed).toBeGreaterThan(WALL_CONTACT_MIN_NORMAL_SPEED);
    expect(normalSpeed / speed).toBeLessThan(WALL_CONTACT_MIN_INCIDENCE_SIN);
    expect(isSignificantBarrierImpact(vx, vy, 0)).toBe(false);
  });

  it('classifies a real lateral wall hit as a wall-impact trace failure', () => {
    const speed = 60;
    const impactAngle = 0.24;
    const vx = Math.cos(impactAngle) * speed;
    const vy = Math.sin(impactAngle) * speed;

    expect(barrierNormalSpeed(vx, vy, 0)).toBeGreaterThan(
      WALL_CONTACT_MIN_NORMAL_SPEED,
    );
    expect(isSignificantBarrierImpact(vx, vy, 0)).toBe(true);
  });

  it('leaves clear physical room outside the usable kerb', () => {
    expect(
      TRACK_BARRIER_OFFSET - TRACK_BARRIER_HALF_THICKNESS - TRACK_KERB_OUTER_OFFSET,
    ).toBeGreaterThan(4);
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
