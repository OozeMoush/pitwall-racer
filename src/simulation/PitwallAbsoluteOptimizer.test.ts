import { describe, expect, it } from 'vitest';
import {
  createPitwallAbsoluteSeed,
  evaluatePitwallAbsolute,
  optimizePitwallAbsolute,
} from './PitwallAbsoluteOptimizer';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

describe('Pitwall absolute executable optimizer', () => {
  it('replays the baked machine-only absolute seed legally', () => {
    installReferenceLineCalibration();
    const result = evaluatePitwallAbsolute(
      OPTIMIZED_REFERENCE_LANES['pitwall-gp'],
      createPitwallAbsoluteSeed(),
    );

    console.log('PITWALL_ABSOLUTE_SEED', JSON.stringify({
      seconds: result.result.lapSeconds === undefined ? null : Number(result.result.lapSeconds.toFixed(3)),
      maxLaneDistance: Number(result.result.maxLaneDistance.toFixed(3)),
      illegalSamples: result.result.illegalSamples,
      slideEvents: result.result.slideEvents,
      genome: result.genome,
    }));

    expect(result.legal).toBe(true);
    expect(result.result.illegalSamples).toBe(0);
    expect(result.result.maxLaneDistance).toBeLessThanOrEqual(REFERENCE_LANE_LIMIT);
    expect(result.result.slideEvents).toBe(0);
    expect(result.result.lapSeconds).toBeDefined();
    expect(result.result.lapSeconds!).toBeLessThanOrEqual(25.517 + 1e-9);
  }, 10_000);

  it('searches coupled line, speed and steering dimensions from the legal seed', () => {
    installReferenceLineCalibration();
    const optimized = optimizePitwallAbsolute(
      OPTIMIZED_REFERENCE_LANES['pitwall-gp'],
      { maxEvaluations: 48, randomSeed: 0x5eed2026 },
    );

    console.log('PITWALL_ABSOLUTE_OPTIMIZER', JSON.stringify({
      evaluations: optimized.evaluations,
      seed: {
        seconds: optimized.seed.result.lapSeconds === undefined
          ? null
          : Number(optimized.seed.result.lapSeconds.toFixed(3)),
        maxLaneDistance: Number(optimized.seed.result.maxLaneDistance.toFixed(3)),
      },
      best: {
        seconds: optimized.best.result.lapSeconds === undefined
          ? null
          : Number(optimized.best.result.lapSeconds.toFixed(3)),
        maxLaneDistance: Number(optimized.best.result.maxLaneDistance.toFixed(3)),
        illegalSamples: optimized.best.result.illegalSamples,
        slideEvents: optimized.best.result.slideEvents,
        genome: optimized.best.genome,
      },
      guide: {
        seconds: optimized.guide.result.lapSeconds === undefined
          ? null
          : Number(optimized.guide.result.lapSeconds.toFixed(3)),
        maxLaneDistance: Number(optimized.guide.result.maxLaneDistance.toFixed(3)),
        illegalSamples: optimized.guide.result.illegalSamples,
        score: Number(optimized.guide.score.toFixed(4)),
      },
      accepted: optimized.accepted,
    }));

    expect(optimized.evaluations).toBe(48);
    expect(optimized.best.legal).toBe(true);
    expect(optimized.best.result.lapSeconds).toBeDefined();
    expect(optimized.seed.result.lapSeconds).toBeDefined();
    expect(optimized.best.result.lapSeconds!).toBeLessThanOrEqual(
      optimized.seed.result.lapSeconds! + 1e-9,
    );
  }, 60_000);
});
