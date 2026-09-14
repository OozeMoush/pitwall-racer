import { describe, expect, it } from 'vitest';
import { resolveAiOccupancy } from './AiOccupancyModel';
import { createAiField } from './RaceModel';

describe('AiOccupancyModel', () => {
  it('does not fabricate lanes or race distance for a close physical pack', () => {
    const field = createAiField();
    for (const driver of field) {
      driver.lap = 2;
      driver.progress = 0.42;
      driver.laneOffset = 0;
      driver.speed = 82;
    }

    const resolved = resolveAiOccupancy(field, 1 / 60);

    expect(resolved).toBe(field);
    expect(resolved.every((driver) => driver.lap === 2)).toBe(true);
    expect(resolved.every((driver) => driver.progress === 0.42)).toBe(true);
    expect(resolved.every((driver) => driver.laneOffset === 0)).toBe(true);
  });

  it('leaves already separated physical metadata untouched', () => {
    const [a, b] = createAiField();
    a.lap = 2;
    a.progress = 0.6;
    a.laneOffset = -8;
    b.lap = 2;
    b.progress = 0.5;
    b.laneOffset = 8;

    const resolved = resolveAiOccupancy([a, b], 1 / 60);
    expect(resolved[0]).toBe(a);
    expect(resolved[1]).toBe(b);
  });
});
