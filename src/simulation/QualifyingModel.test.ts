import { describe, expect, it } from 'vitest';
import { createAiField } from './RaceModel';
import { referenceLap } from './ReferenceDriverModel';
import { compoundPeakGrip } from './TireModel';
import {
  aiQualifyingTime,
  qualifyingBenchmarkSeconds,
  qualifyingClassification,
  qualifyingGridOrder,
} from './QualifyingModel';

describe('QualifyingModel', () => {
  it('uses the generated machine-limit reference rather than a hand-authored player target', () => {
    const grip = compoundPeakGrip('SOFT', 'PUSH');
    const reference = referenceLap('pitwall-gp', grip).lapSeconds;
    const benchmark = qualifyingBenchmarkSeconds('pitwall-gp', 2071);

    expect(benchmark).toBeCloseTo(reference, 6);
  });

  it('keeps the field compact while allowing the strongest car to beat the benchmark', () => {
    const field = createAiField();
    const benchmark = 23;
    const times = field.map((driver) =>
      aiQualifyingTime(driver, 'pitwall-gp', 2071, benchmark));
    expect(Math.max(...times) - Math.min(...times)).toBeLessThan(0.55);
    expect(Math.min(...times)).toBeLessThan(22.85);
    expect(Math.max(...times)).toBeGreaterThan(23.0);
  });

  it('makes a benchmark lap a midfield result and a slower lap a back-row result', () => {
    const field = createAiField();
    const benchmark = 23;
    const nearLimit = qualifyingClassification(
      benchmark,
      field,
      'pitwall-gp',
      2071,
      benchmark,
    );
    const ordinary = qualifyingClassification(
      benchmark + 0.55,
      field,
      'pitwall-gp',
      2071,
      benchmark,
    );

    const benchmarkPosition =
      nearLimit.find((entry) => entry.id === 'player')?.position ?? 8;
    expect(benchmarkPosition).toBeGreaterThanOrEqual(3);
    expect(benchmarkPosition).toBeLessThanOrEqual(7);
    expect(ordinary.find((entry) => entry.id === 'player')?.position).toBeGreaterThanOrEqual(7);
    expect(qualifyingGridOrder(nearLimit)).toHaveLength(8);
  });
});
