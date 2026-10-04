import { describe, expect, it } from 'vitest';
import { raceLapsForPreset } from '../game/RaceSetup';
import { benchmarkStrategies, simulateStrategy, strategyRaceProfile } from './StrategySimulator';
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
  it('spreads AI strategies across the duration-derived standard race', () => {
    const totalLaps = raceLapsForPreset('pitwall-gp', 'STANDARD');
    const field = createAiField(undefined, totalLaps);
    expect(field.filter((driver) => driver.nextCompound === 'HARD')).toHaveLength(3);
    expect(field.filter((driver) => driver.nextCompound === 'SOFT')).toHaveLength(1);
    expect(field.filter((driver) => driver.nextCompound === 'MEDIUM')).toHaveLength(3);
    expect(field.find((driver) => driver.name === 'ORBIT')?.plannedPitLap)
      .toBe(Math.round(totalLaps * 0.39));
    expect(field.find((driver) => driver.name === 'RIFT')?.plannedPitLap)
      .toBe(Math.round(totalLaps * 0.39));

    const kite = field.find((driver) => driver.name === 'KITE')!;
    expect(kite.pitPlan).toEqual([
      { plannedLap: Math.round(totalLaps * 0.39), compound: 'MEDIUM' },
      { plannedLap: Math.round(totalLaps * 0.67), compound: 'HARD' },
    ]);
    expect(kite.pitStopIndex).toBe(0);
  });

  it('arms KITE second stop after completing the first scheduled stop', () => {
    const totalLaps = raceLapsForPreset('pitwall-gp', 'STANDARD');
    const kite = createAiField(undefined, totalLaps).find((driver) => driver.name === 'KITE')!;
    kite.lap = kite.pitPlan[0].plannedLap;
    kite.progress = 0.999;
    kite.speed = 90;
    kite.strategyIntent = 'UNDERCUT';
    const afterFirstStop = stepAi(kite, 0.1, totalLaps);

    expect(afterFirstStop.tire.compound).toBe('MEDIUM');
    expect(afterFirstStop.pitStopIndex).toBe(1);
    expect(afterFirstStop.nextCompound).toBe('HARD');
    expect(afterFirstStop.plannedPitLap).toBe(kite.pitPlan[1].plannedLap);
    expect(afterFirstStop.pitLap).toBe(kite.pitPlan[1].plannedLap);
    expect(afterFirstStop.strategyIntent).toBe('PLAN');
  });

  it('keeps every live standard CPU plan within the competitive strategy envelope', () => {
    const totalLaps = raceLapsForPreset('pitwall-gp', 'STANDARD');
    const race = strategyRaceProfile('pitwall-gp', totalLaps);
    const benchmark = benchmarkStrategies(race);
    const field = createAiField(undefined, totalLaps);

    for (const driver of field) {
      const result = simulateStrategy({
        name: driver.name,
        startCompound: driver.tire.compound,
        stops: driver.pitPlan.map((stop) => ({
          afterLap: stop.plannedLap,
          compound: stop.compound,
        })),
        paceForLap: () => 'BALANCED',
      }, race);

      expect(
        result.totalTime - benchmark.fastest.totalTime,
        `${driver.name} strategy gap`,
      ).toBeLessThan(13);
    }
  });

  it('scales planned pit windows with the selected duration preset', () => {
    const shortLaps = raceLapsForPreset('pitwall-gp', 'SHORT');
    const longLaps = raceLapsForPreset('pitwall-gp', 'LONG');
    const short = createAiField(undefined, shortLaps);
    const long = createAiField(undefined, longLaps);
    expect(short.find((driver) => driver.name === 'APEX')?.plannedPitLap)
      .toBe(Math.round(shortLaps * 0.33));
    expect(long.find((driver) => driver.name === 'APEX')?.plannedPitLap)
      .toBe(Math.round(longLaps * 0.33));
    expect(long.find((driver) => driver.name === 'ZEN')?.plannedPitLap)
      .toBe(Math.round(longLaps * 0.61));
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

  it('follows a slower car longitudinally without changing its line', () => {
    const [leader, chaser] = createAiField();
    leader.progress = 0.5 + raceScaleDistance(68) / TRACK_LENGTH;
    chaser.progress = 0.5;
    leader.skill = 1.04;
    chaser.skill = 0.92;
    leader.laneOffset = 3;
    chaser.laneOffset = -3;

    const [baseline] = stepAiField([{ ...chaser }], 0.1, 50);
    const [, nextChaser] = stepAiField([leader, chaser], 0.1, 50);
    expect(nextChaser.battleState).toBe('FOLLOW');
    expect(nextChaser.laneOffset).toBeCloseTo(baseline.laneOffset, 8);
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
    const [baseline] = stepAiField([{ ...chaser }], 0.1, 50);
    expect(nextChaser.laneOffset).toBeCloseTo(baseline.laneOffset, 8);
  });

  it('lets a car on a separate lane keep its own pace without an attack state', () => {
    const [leader, chaser] = createAiField();
    leader.progress = 0.1 + raceScaleDistance(50) / TRACK_LENGTH;
    chaser.progress = 0.1;
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

    const [baseline] = stepAiField([{ ...driver }], 0.1, 50);
    const [next] = stepAiField([driver], 0.1, 50, [player]);
    expect(next.battleState).toBe('FOLLOW');
    expect(next.laneOffset).toBeCloseTo(baseline.laneOffset, 8);
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

    const [baseline] = stepAiField([{ ...driver }], 0.1, 50);
    const [next] = stepAiField([driver], 0.1, 50, [player]);
    expect(next.battleState).toBe('CLEAR');
    // Preferred-line movement is allowed; the approaching player must not add
    // a separate defensive lane change.
    expect(next.laneOffset).toBeCloseTo(baseline.laneOffset, 6);
  });

  it('keeps its normal line when the player is alongside', () => {
    const [driver] = createAiField();
    driver.progress = 0.55;
    driver.laneOffset = 4;
    const player: RaceTrafficCar = {
      id: 'player', lap: driver.lap, progress: 0.55, speed: 78,
      laneOffset: -4, performance: 1, isPlayer: true,
    };

    const [baseline] = stepAiField([{ ...driver }], 0.1, 50);
    const [next] = stepAiField([driver], 0.1, 50, [player]);
    expect(next.battleState).toBe('CLEAR');
    expect(next.laneOffset).toBeCloseTo(baseline.laneOffset, 8);
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
