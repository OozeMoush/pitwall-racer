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

  it('keeps the F1-level field within tenths around 98-100 percent execution', () => {
    const field = createAiField();
    const times = field.map((driver) => aiQualifyingTime(driver, 'pitwall-gp', 2071));
    expect(Math.max(...times) - Math.min(...times)).toBeLessThan(0.55);
  });

  it('requires the player to approach the reference limit to qualify at the front', () => {
    const field = createAiField();
    const reference = qualifyingBenchmarkSeconds('pitwall-gp', 2071);
    const nearLimit = qualifyingClassification(reference + 0.10, field, 'pitwall-gp', 2071);
    const ordinary = qualifyingClassification(reference + 0.55, field, 'pitwall-gp', 2071);

    expect(nearLimit.find((entry) => entry.id === 'player')?.position).toBeLessThanOrEqual(2);
    expect(ordinary.find((entry) => entry.id === 'player')?.position).toBeGreaterThanOrEqual(6);
    expect(qualifyingGridOrder(nearLimit)).toHaveLength(8);
  });
});
