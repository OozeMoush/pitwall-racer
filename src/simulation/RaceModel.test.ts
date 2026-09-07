import { describe, expect, it } from 'vitest';
import { aeroEffect, classify, createAiField, isTwoCompoundLegal, stepAi } from './RaceModel';
import { TRACK_LENGTH } from './TrackModel';

describe('RaceModel', () => {
  it('requires two distinct dry compounds', () => {
    expect(isTwoCompoundLegal(new Set(['MEDIUM']))).toBe(false);
    expect(isTwoCompoundLegal(new Set(['MEDIUM', 'HARD']))).toBe(true);
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
});
