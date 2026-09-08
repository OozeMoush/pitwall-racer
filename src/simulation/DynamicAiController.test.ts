import { describe, expect, it } from 'vitest';
import { dynamicAiControl } from './DynamicAiController';
import { createAiField, type RaceTrafficCar } from './RaceModel';
import { sampleTrack, TRACK_LENGTH } from './TrackModel';
import { createVehicle } from './VehicleModel';

describe('dynamicAiControl', () => {
  it('moves off line to attack a slower car ahead', () => {
    const driver = createAiField()[0];
    const p = sampleTrack(driver.progress, 0);
    const vehicle = { ...createVehicle(p.x, p.y, p.heading), speed: 78 };
    const ahead: RaceTrafficCar = {
      id: 'leader',
      lap: driver.lap,
      progress: driver.progress + 28 / TRACK_LENGTH,
      speed: 68,
      laneOffset: 0,
      performance: 1,
    };

    const control = dynamicAiControl(driver, vehicle, [ahead]);
    expect(control.battleState).toBe('ATTACK');
    expect(Math.abs(control.targetLane - ahead.laneOffset)).toBeGreaterThan(20);
  });

  it('leaves lateral room when another car is alongside', () => {
    const driver = createAiField()[1];
    const p = sampleTrack(driver.progress, 8);
    const vehicle = { ...createVehicle(p.x, p.y, p.heading), speed: 72 };
    const other: RaceTrafficCar = {
      id: 'player',
      lap: driver.lap,
      progress: driver.progress + 5 / TRACK_LENGTH,
      speed: 72,
      laneOffset: -7,
      performance: 1,
      isPlayer: true,
    };

    const control = dynamicAiControl(driver, vehicle, [other]);
    expect(control.battleState).toBe('SIDE_BY_SIDE');
    expect(Math.abs(control.targetLane - other.laneOffset)).toBeGreaterThanOrEqual(28);
  });

  it('prioritizes recovery when far outside the road', () => {
    const driver = createAiField()[2];
    const p = sampleTrack(driver.progress, 150);
    const vehicle = { ...createVehicle(p.x, p.y, p.heading), speed: 82 };

    const control = dynamicAiControl(driver, vehicle, []);
    expect(control.targetLane).toBe(0);
    expect(control.targetSpeed).toBeLessThanOrEqual(54);
    expect(control.brake).toBeGreaterThan(0);
  });
});
