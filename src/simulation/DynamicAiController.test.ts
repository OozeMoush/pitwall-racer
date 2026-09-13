import { describe, expect, it } from 'vitest';
import { dynamicAiControl } from './DynamicAiController';
import { createAiField, type RaceTrafficCar } from './RaceModel';
import { AI_SAFE_LANE_LIMIT, TRACK_RUNOFF_HALF_WIDTH } from './TrackLimitsModel';
import { sampleTrack, TRACK_LENGTH } from './TrackModel';
import { createVehicle } from './VehicleModel';

describe('dynamicAiControl', () => {
  it('moves off line to attack a slower car ahead without snapping across the road', () => {
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
    expect(Math.abs(control.targetLane - ahead.laneOffset)).toBeGreaterThan(3.5);
    expect(Math.abs(control.targetLane)).toBeLessThanOrEqual(4.05);
    expect(Math.abs(control.targetLane)).toBeLessThanOrEqual(AI_SAFE_LANE_LIMIT);
  });

  it('leaves usable lateral room when another car is alongside', () => {
    const driver = createAiField()[1];
    const p = sampleTrack(driver.progress, 5);
    const vehicle = { ...createVehicle(p.x, p.y, p.heading), speed: 72 };
    const other: RaceTrafficCar = {
      id: 'player',
      lap: driver.lap,
      progress: driver.progress + 5 / TRACK_LENGTH,
      speed: 72,
      laneOffset: -5,
      performance: 1,
      isPlayer: true,
    };

    const control = dynamicAiControl(driver, vehicle, [other]);
    expect(control.battleState).toBe('SIDE_BY_SIDE');
    expect(Math.abs(control.targetLane - other.laneOffset)).toBeGreaterThanOrEqual(5.6);
    expect(Math.abs(control.targetLane)).toBeLessThanOrEqual(AI_SAFE_LANE_LIMIT);
  });

  it('prioritizes a controlled recovery before an excursion becomes permanent', () => {
    const driver = createAiField()[2];
    const laneOffset = TRACK_RUNOFF_HALF_WIDTH + 5;
    const p = sampleTrack(driver.progress, laneOffset);
    const vehicle = { ...createVehicle(p.x, p.y, p.heading), speed: 82 };

    const control = dynamicAiControl(driver, vehicle, []);
    expect(Math.abs(control.targetLane)).toBeLessThan(laneOffset);
    expect(Math.abs(control.targetLane - laneOffset)).toBeLessThanOrEqual(7.01);
    expect(control.targetSpeed).toBeLessThanOrEqual(30);
    expect(control.brake).toBeGreaterThan(0);
  });
});
