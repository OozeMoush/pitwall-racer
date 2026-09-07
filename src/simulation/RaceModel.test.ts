import { describe, expect, it } from 'vitest';
import type { Compound } from './TireModel';
import { aeroEffect, classify, createAiField, isTwoCompoundLegal, stepAi, stepAiField } from './RaceModel';
import { TRACK_LENGTH } from './TrackModel';

describe('RaceModel', () => {
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
    car.lap = 7;
    car.progress = 0.999;
    const stepped = stepAi(car, 0.1, 8);
    expect(stepped.lap).toBe(8);
    expect(stepped.finished).toBe(false);
  });

  it('settles into the tow when a car is ahead but not yet attackable', () => {
    const [leader, chaser] = createAiField();
    leader.progress = 0.5 + 32 / TRACK_LENGTH;
    chaser.progress = 0.5;
    leader.skill = 1;
    chaser.skill = 1.02;
    leader.laneOffset = 8;
    chaser.laneOffset = -8;

    const [, nextChaser] = stepAiField([leader, chaser], 0.1, 8);
    expect(nextChaser.battleState).toBe('FOLLOW');
    expect(nextChaser.laneOffset).toBeGreaterThan(-8);
  });

  it('moves off line to attack a slower car at close range', () => {
    const [leader, chaser] = createAiField();
    leader.progress = 0.5 + 11 / TRACK_LENGTH;
    chaser.progress = 0.5;
    leader.skill = 0.94;
    chaser.skill = 1.08;
    leader.laneOffset = 0;
    chaser.laneOffset = 0;

    const [, nextChaser] = stepAiField([leader, chaser], 0.1, 8);
    expect(nextChaser.battleState).toBe('ATTACK');
    expect(Math.abs(nextChaser.laneOffset)).toBeGreaterThan(0);
  });

  it('undercuts one lap early when trapped in traffic near the pit window', () => {
    const [leader, chaser] = createAiField();
    leader.lap = 3;
    chaser.lap = 3;
    leader.progress = 0.5 + 22 / TRACK_LENGTH;
    chaser.progress = 0.5;
    leader.skill = 1.04;
    chaser.skill = 0.98;
    chaser.plannedPitLap = 4;
    chaser.pitLap = 4;

    const [, nextChaser] = stepAiField([leader, chaser], 0.1, 8);
    expect(nextChaser.battleState).toBe('FOLLOW');
    expect(nextChaser.strategyIntent).toBe('UNDERCUT');
    expect(nextChaser.pitLap).toBe(3);
  });

  it('overcuts one lap when in clean air on healthy tyres', () => {
    const [driver] = createAiField();
    driver.lap = driver.plannedPitLap;
    driver.progress = 0.4;

    const next = stepAi(driver, 0.1, 8);
    expect(next.battleState).toBe('CLEAR');
    expect(next.strategyIntent).toBe('OVERCUT');
    expect(next.pitLap).toBe(driver.plannedPitLap + 1);
  });
});
