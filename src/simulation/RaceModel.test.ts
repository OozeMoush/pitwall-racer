import { describe, expect, it } from 'vitest';
import { createTire, type Compound } from './TireModel';
import { trackProfile } from './TrackProfile';
import {
  aeroEffect,
  classify,
  createAiField,
  isTwoCompoundLegal,
  stepAi,
  stepAiField,
  type RaceTrafficCar,
} from './RaceModel';
import { raceScaleDistance, TRACK_LENGTH } from './TrackModel';

describe('RaceModel', () => {
  it('spreads AI strategies and includes an aggressive Soft-Medium-Soft two-stop', () => {
    const field = createAiField(undefined, 50);
    expect(field.filter((driver) => driver.nextCompound === 'HARD')).toHaveLength(2);
    expect(field.filter((driver) => driver.nextCompound === 'SOFT')).toHaveLength(3);
    expect(field.filter((driver) => driver.nextCompound === 'MEDIUM')).toHaveLength(2);
    expect(field.find((driver) => driver.name === 'ORBIT')?.plannedPitLap).toBe(36);
    expect(field.find((driver) => driver.name === 'RIFT')?.plannedPitLap).toBe(38);

    const kite = field.find((driver) => driver.name === 'KITE')!;
    expect(kite.pitPlan).toEqual([
      { plannedLap: 12, compound: 'MEDIUM' },
      { plannedLap: 36, compound: 'SOFT' },
    ]);
    expect(kite.pitStopIndex).toBe(0);
  });

  it('arms KITE second stop after completing the first scheduled stop', () => {
    const kite = createAiField(undefined, 50).find((driver) => driver.name === 'KITE')!;
    kite.lap = 12;
    kite.progress = 0.999;
    kite.speed = 90;
    kite.strategyIntent = 'UNDERCUT';
    const afterFirstStop = stepAi(kite, 0.1, 50);

    expect(afterFirstStop.tire.compound).toBe('MEDIUM');
    expect(afterFirstStop.pitStopIndex).toBe(1);
    expect(afterFirstStop.nextCompound).toBe('SOFT');
    expect(afterFirstStop.plannedPitLap).toBe(36);
    expect(afterFirstStop.pitLap).toBe(36);
    expect(afterFirstStop.strategyIntent).toBe('PLAN');
  });

  it('scales planned pit windows with the selected race length', () => {
    const forty = createAiField(undefined, 40);
    const sixty = createAiField(undefined, 60);
    expect(forty.find((driver) => driver.name === 'APEX')?.plannedPitLap).toBe(16);
    expect(sixty.find((driver) => driver.name === 'APEX')?.plannedPitLap).toBe(24);
    expect(sixty.find((driver) => driver.name === 'ZEN')?.plannedPitLap).toBe(44);
  });

  it('requires two distinct dry compounds', () => {
    expect(isTwoCompoundLegal(new Set<Compound>(['MEDIUM']))).toBe(false);
    expect(isTwoCompoundLegal(new Set<Compound>(['MEDIUM', 'HARD']))).toBe(true);
  });

  it('classifies cars by completed race distance', () => {
    const order = classify([
      { id: 'a', lap: 2, progress: 0.2 },
      { id: 'b', lap: 1, progress: 0.95 },
      { id: 'c', lap: 2, progress: 0.6 },
    ]);
    expect(order.map((car) => car.id)).toEqual(['c', 'a', 'b']);
  });

  it('produces tow and dirty air only when a car is close ahead', () => {
    const [car] = createAiField();
    car.lap = 2;
    car.progress = 0.5 + 20 / TRACK_LENGTH;
    const close = aeroEffect(2, 0.5, [car]);
    expect(close.tow).toBeGreaterThan(0);
    expect(close.dirtyAir).toBeGreaterThan(0);

    car.progress = 0.5 + 80 / TRACK_LENGTH;
    expect(aeroEffect(2, 0.5, [car]).dirtyAir).toBe(0);
  });

  it('does not finish an AI car merely by entering the final lap', () => {
    const [car] = createAiField();
    car.lap = 49;
    car.progress = 0.999;
    car.speed = 90;
    const stepped = stepAi(car, 0.1, 50);
    expect(stepped.lap).toBe(50);
    expect(stepped.finished).toBe(false);
  });

  it('accelerates on a straight and brakes a Medium for a demanding corner', () => {
    const samples = Array.from({ length: 240 }, (_, index) => ({
      progress: index / 240,
      profile: trackProfile(index / 240, 1, createTire('MEDIUM').grip),
    }));
    const straight = samples.reduce((best, sample) => sample.profile.targetSpeed > best.profile.targetSpeed ? sample : best);
    const corner = samples.reduce((best, sample) => sample.profile.targetSpeed < best.profile.targetSpeed ? sample : best);

    const [straightCar] = createAiField();
    straightCar.tire = createTire('MEDIUM');
    straightCar.progress = straight.progress;
    straightCar.speed = 75;
    expect(stepAi(straightCar, 0.2, 50).speed).toBeGreaterThan(75);

    const [cornerCar] = createAiField();
    cornerCar.tire = createTire('MEDIUM');
    cornerCar.progress = corner.progress;
    cornerCar.speed = 95;
    expect(stepAi(cornerCar, 0.2, 50).speed).toBeLessThan(95);
  });

  it('settles into the tow when a weaker car cannot attack yet', () => {
    const [leader, chaser] = createAiField();
    leader.progress = 0.5 + raceScaleDistance(68) / TRACK_LENGTH;
    chaser.progress = 0.5;
    leader.skill = 1.04;
    chaser.skill = 0.92;
    leader.laneOffset = 3;
    chaser.laneOffset = -3;

    const [, nextChaser] = stepAiField([leader, chaser], 0.1, 50);
    expect(nextChaser.battleState).toBe('FOLLOW');
    expect(nextChaser.laneOffset).toBeGreaterThan(-3);
  });

  it('keeps a quicker close-range car in FOLLOW instead of inventing an attack lane', () => {
    const [leader, chaser] = createAiField();
    leader.tire = createTire('HARD');
    chaser.tire = createTire('SOFT');
    leader.progress = 0.5 + raceScaleDistance(40) / TRACK_LENGTH;
    chaser.progress = 0.5;
    leader.skill = 0.94;
    chaser.skill = 1.08;
    leader.laneOffset = 0;
    chaser.laneOffset = 0;

    const [, nextChaser] = stepAiField([leader, chaser], 0.1, 50);
    expect(nextChaser.battleState).toBe('FOLLOW');
    // RaceModel no longer synthesizes a passing lane. The physical controller
    // decides whether there is safe lateral room on the real circuit.
    expect(Math.abs(nextChaser.laneOffset)).toBeLessThan(1);
  });

  it('lets a car on a separate lane keep its own pace without an attack state', () => {
    const [leader, chaser] = createAiField();
    leader.progress = 0.25 + raceScaleDistance(50) / TRACK_LENGTH;
    chaser.progress = 0.25;
    leader.speed = 82;
    chaser.speed = 88;
    leader.skill = 0.94;
    chaser.skill = 1.09;
    leader.laneOffset = -10;
    chaser.laneOffset = 10;

    const [, nextChaser] = stepAiField([leader, chaser], 0.15, 50);
    expect(nextChaser.battleState).toBe('CLEAR');
    expect(nextChaser.speed).toBeGreaterThan(leader.speed);
  });

  it('treats the player ahead as real traffic without forcing a lateral attack', () => {
    const [driver] = createAiField();
    driver.progress = 0.4;
    driver.laneOffset = 0;
    driver.skill = 1.08;
    const player: RaceTrafficCar = {
      id: 'player', lap: driver.lap,
      progress: 0.4 + raceScaleDistance(28) / TRACK_LENGTH,
      speed: 68, laneOffset: 0, performance: 0.92, isPlayer: true,
    };

    const [next] = stepAiField([driver], 0.1, 50, [player]);
    expect(next.battleState).toBe('FOLLOW');
    expect(Math.abs(next.laneOffset)).toBeLessThan(1);
  });

  it('does not weave defensively just because the player is approaching from behind', () => {
    const [driver] = createAiField();
    driver.progress = 0.5;
    driver.laneOffset = 0;
    const player: RaceTrafficCar = {
      id: 'player', lap: driver.lap,
      progress: 0.5 - raceScaleDistance(38) / TRACK_LENGTH,
      speed: 92, laneOffset: -8, performance: 1.08, isPlayer: true,
    };

    const [next] = stepAiField([driver], 0.1, 50, [player]);
    expect(next.battleState).toBe('CLEAR');
    expect(Math.abs(next.laneOffset)).toBeLessThan(1);
  });

  it('leaves lateral space when the player is genuinely alongside', () => {
    const [driver] = createAiField();
    driver.progress = 0.55;
    driver.laneOffset = 4;
    const player: RaceTrafficCar = {
      id: 'player', lap: driver.lap, progress: 0.55, speed: 78,
      laneOffset: -4, performance: 1, isPlayer: true,
    };

    const [next] = stepAiField([driver], 0.1, 50, [player]);
    expect(next.battleState).toBe('SIDE_BY_SIDE');
    expect(Math.abs(next.laneOffset - player.laneOffset)).toBeGreaterThanOrEqual(5.4);
  });

  it('undercuts two laps early when genuinely trapped in the same lane', () => {
    const [leader, chaser] = createAiField();
    leader.lap = 10;
    chaser.lap = 10;
    leader.progress = 0.5 + raceScaleDistance(34) / TRACK_LENGTH;
    chaser.progress = 0.5;
    leader.skill = 1.06;
    chaser.skill = 0.92;
    leader.laneOffset = 0;
    chaser.laneOffset = 0;
    chaser.plannedPitLap = 12;
    chaser.pitLap = 12;

    const [, nextChaser] = stepAiField([leader, chaser], 0.1, 50);
    expect(nextChaser.battleState).toBe('FOLLOW');
    expect(nextChaser.strategyIntent).toBe('UNDERCUT');
    expect(nextChaser.pitLap).toBe(10);
  });

  it('overcuts two laps in clean air on healthy tyres', () => {
    const [driver] = createAiField();
    driver.lap = driver.plannedPitLap;
    driver.progress = 0.4;

    const next = stepAi(driver, 0.1, 50);
    expect(next.battleState).toBe('CLEAR');
    expect(next.strategyIntent).toBe('OVERCUT');
    expect(next.pitLap).toBe(driver.plannedPitLap + 2);
  });
});
