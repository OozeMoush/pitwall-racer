import { describe, expect, it } from 'vitest';
import { createAiField, raceDistance, stepAiField } from './RaceModel';

describe('race start regression', () => {
  it('treats crossing the line from lap zero as the start of lap one', () => {
    expect(raceDistance(1, 0.002)).toBeGreaterThan(raceDistance(0, 0.998));
  });

  it('does not let the strategy model advance a second virtual AI car in the dynamic race', () => {
    const [driver] = createAiField();
    const before = { lap: driver.lap, progress: driver.progress };
    const [after] = stepAiField([driver], 0.5, 8, [], false);

    expect(after.lap).toBe(before.lap);
    expect(after.progress).toBe(before.progress);
  });

  it('puts the launch state on lap zero instead of pretending lap one is already complete', () => {
    for (const driver of createAiField()) expect(driver.lap).toBe(0);
  });
});
