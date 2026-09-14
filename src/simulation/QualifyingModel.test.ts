import { describe, expect, it } from 'vitest';
import { createAiField } from './RaceModel';
import {
  aiQualifyingTime,
  qualifyingBenchmarkSeconds,
  qualifyingClassification,
  qualifyingGridOrder,
} from './QualifyingModel';

describe('QualifyingModel', () => {
  it('uses a fixed player-level miniature flying-lap target rather than adapting to the player', () => {
    const pitwall = qualifyingBenchmarkSeconds('pitwall-gp', 2071);
    const velocity = qualifyingBenchmarkSeconds('velocity-park', 2071);
    // Human playtesting is already in the high-26 / 27 second range. A field of
    // professional F1 drivers should live in that same window, not six seconds
    // behind it.
    expect(pitwall).toBeGreaterThan(25.5);
    expect(pitwall).toBeLessThan(28.5);
    expect(velocity).toBeLessThan(pitwall);
  });

  it('keeps the AI field close enough for qualifying tenths to matter', () => {
    const field = createAiField();
    const times = field.map((driver) => aiQualifyingTime(driver, 'pitwall-gp', 2071));
    expect(Math.max(...times) - Math.min(...times)).toBeLessThan(0.75);
  });

  it('puts a genuinely quick player ahead and a slower player into the pack', () => {
    const field = createAiField();
    const benchmark = qualifyingBenchmarkSeconds('pitwall-gp', 2071);
    const fast = qualifyingClassification(benchmark - 0.6, field, 'pitwall-gp', 2071);
    const slow = qualifyingClassification(benchmark + 0.7, field, 'pitwall-gp', 2071);

    expect(fast.find((entry) => entry.id === 'player')?.position).toBeLessThanOrEqual(2);
    expect(slow.find((entry) => entry.id === 'player')?.position).toBeGreaterThanOrEqual(6);
    expect(qualifyingGridOrder(fast)).toHaveLength(8);
  });
});
