import { describe, expect, it } from 'vitest';
import { PaceEvidenceAccumulator } from './PaceEvidenceAccumulator';
import { DEEP_CUT_DISTANCE, TRACK_RUNOFF_HALF_WIDTH } from './TrackLimitsModel';

describe('PaceEvidenceAccumulator', () => {
  it('records a clean lap without manufacturing invalidity', () => {
    const accumulator = new PaceEvidenceAccumulator();
    accumulator.begin('SOFT', 0.02);
    for (let i = 0; i < 100; i++) accumulator.sample(DEEP_CUT_DISTANCE - 0.5, 0);

    const lap = accumulator.finish('pitwall-gp', 24.5, 0.08);
    expect(lap.deepCutRatio).toBe(0);
    expect(lap.grassRatio).toBe(0);
    expect(lap.maxTow).toBe(0);
    expect(lap.recovered).toBe(false);
    expect(lap.pitted).toBe(false);
  });

  it('captures the fraction of a lap spent beyond deep-cut and grass limits', () => {
    const accumulator = new PaceEvidenceAccumulator();
    accumulator.begin('SOFT', 0);
    for (let i = 0; i < 8; i++) accumulator.sample(0, 0);
    accumulator.sample(DEEP_CUT_DISTANCE + 0.2, 0);
    accumulator.sample(TRACK_RUNOFF_HALF_WIDTH + 0.2, 0);

    const lap = accumulator.finish('pitwall-gp', 24.5, 0.1);
    expect(lap.deepCutRatio).toBeCloseTo(0.2);
    expect(lap.grassRatio).toBeCloseTo(0.1);
  });

  it('retains maximum tow and explicit recovery/pit/launch flags', () => {
    const accumulator = new PaceEvidenceAccumulator();
    accumulator.begin('SOFT', 0.05);
    accumulator.sample(0, 0.04, true);
    accumulator.sample(0, 0.13);
    accumulator.markRecovered();
    accumulator.markPitted();

    const lap = accumulator.finish('pitwall-gp', 30, 0.2);
    expect(lap.maxTow).toBe(0.13);
    expect(lap.launchAffected).toBe(true);
    expect(lap.recovered).toBe(true);
    expect(lap.pitted).toBe(true);
  });
});
