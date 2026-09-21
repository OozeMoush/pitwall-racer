import { afterEach, describe, expect, it } from 'vitest';
import { dynamicAiControl } from './DynamicAiController';
import { createAiField, type RaceTrafficCar } from './RaceModel';
import { setRuntimeRacingLine } from './RacingLineRuntime';
import { AI_SAFE_LANE_LIMIT, TRACK_RUNOFF_HALF_WIDTH } from './TrackLimitsModel';
import { sampleTrack, TRACK_LENGTH } from './TrackModel';
import { createVehicle } from './VehicleModel';

afterEach(() => {
  setRuntimeRacingLine('pitwall-gp', undefined);
});

describe('dynamicAiControl', () => {
  it('uses the tow first, then moves off line smoothly to attack without crossing the road', () => {
    const driver = createAiField()[0];
    const p = sampleTrack(driver.progress, 0);
    const vehicle = { ...createVehicle(p.x, p.y, p.heading), speed: 78 };
    const ahead: RaceTrafficCar = {
      id: 'leader',
      lap: driver.lap,
      progress: driver.progress + 26 / TRACK_LENGTH,
      speed: 68,
      laneOffset: 0,
      performance: 1,
    };

    const follow = dynamicAiControl(driver, vehicle, [ahead]);
    expect(follow.battleState).toBe('FOLLOW');

    const closeAhead = {
      ...ahead,
      progress: driver.progress + 12 / TRACK_LENGTH,
    };
    const attack = dynamicAiControl(driver, vehicle, [closeAhead]);
    expect(attack.battleState).toBe('ATTACK');
    expect(Math.abs(attack.targetLane - closeAhead.laneOffset)).toBeGreaterThanOrEqual(2.2);
    // A 3.2 m first move is deliberate enough to clear the wake without the
    // old full-lane jump; the separate stable-side regression prevents it from
    // oscillating back across the rival on the next controller tick.
    expect(Math.abs(attack.targetLane)).toBeLessThanOrEqual(3.3);
    expect(Math.abs(attack.targetLane)).toBeLessThanOrEqual(AI_SAFE_LANE_LIMIT);
  });

  it('commits to the same passing side instead of weaving across the rival', () => {
    const driver = createAiField()[0];
    const ahead: RaceTrafficCar = {
      id: 'leader',
      lap: driver.lap,
      progress: driver.progress + 10 / TRACK_LENGTH,
      speed: 68,
      laneOffset: 0,
      performance: 1,
    };
    const left = sampleTrack(driver.progress, -1.2);
    const right = sampleTrack(driver.progress, 1.2);
    const leftControl = dynamicAiControl(driver, { ...createVehicle(left.x, left.y, left.heading), speed: 78 }, [ahead]);
    const rightControl = dynamicAiControl(driver, { ...createVehicle(right.x, right.y, right.heading), speed: 78 }, [ahead]);

    expect(leftControl.battleState).toBe('ATTACK');
    expect(rightControl.battleState).toBe('ATTACK');
    expect(Math.sign(leftControl.targetLane)).toBe(Math.sign(rightControl.targetLane));
  });

  it('holds a real side-by-side lane against another AI instead of reforming a train', () => {
    const driver = createAiField()[1];
    const p = sampleTrack(driver.progress, 5.5);
    const vehicle = { ...createVehicle(p.x, p.y, p.heading), speed: 76 };
    const other: RaceTrafficCar = {
      id: 'ai-rival',
      lap: driver.lap,
      progress: driver.progress + 4 / TRACK_LENGTH,
      speed: 75,
      laneOffset: -1.0,
      performance: driver.skill * driver.tire.grip,
    };

    const control = dynamicAiControl(driver, vehicle, [other]);
    expect(control.battleState).toBe('SIDE_BY_SIDE');
    expect(Math.abs(control.targetLane - other.laneOffset)).toBeGreaterThanOrEqual(6.0);
    expect(Math.abs(control.targetLane)).toBeLessThanOrEqual(AI_SAFE_LANE_LIMIT);
  });

  it('leaves usable lateral room when the player is alongside', () => {
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
    expect(Math.abs(control.targetLane - other.laneOffset)).toBeGreaterThanOrEqual(6.0);
    expect(Math.abs(control.targetLane)).toBeLessThanOrEqual(AI_SAFE_LANE_LIMIT);
  });

  it('locks directly onto an explicit player lane instead of soft-clamping the target', () => {
    const driver = createAiField()[0];
    const p = sampleTrack(driver.progress, 0);
    const vehicle = { ...createVehicle(p.x, p.y, p.heading), speed: 64 };
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: driver.tire.grip,
      points: Array.from({ length: 160 }, (_, index) => ({
        progress: index / 160,
        laneOffset: 8,
        targetSpeed: 64,
      })),
    });

    const control = dynamicAiControl(driver, vehicle, []);
    expect(control.battleState).toBe('CLEAR');
    expect(control.targetLane).toBeGreaterThan(6.5);
  });

  it('aims straight back at the circuit after an excursion', () => {
    const driver = createAiField()[2];
    const laneOffset = TRACK_RUNOFF_HALF_WIDTH + 5;
    const p = sampleTrack(driver.progress, laneOffset);
    const vehicle = { ...createVehicle(p.x, p.y, p.heading), speed: 82 };

    const control = dynamicAiControl(driver, vehicle, []);
    expect(control.targetLane).toBe(0);
    expect(control.targetSpeed).toBeLessThanOrEqual(40);
    expect(control.brake).toBeGreaterThan(0);
  });
});
