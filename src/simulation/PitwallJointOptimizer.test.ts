import { describe, expect, it } from 'vitest';
import {
  createPitwallJointSeed,
  evaluatePitwallJoint,
  optimizePitwallJoint,
} from './PitwallJointOptimizer';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

describe('Pitwall course-specific joint optimizer', () => {
  it('replays the discovered legal joint seed without rediscovering it in CI', () => {
    installReferenceLineCalibration();
    const result = evaluatePitwallJoint(
      OPTIMIZED_REFERENCE_LANES['pitwall-gp'],
      createPitwallJointSeed(),
    );

    console.log('PITWALL_JOINT_SEED', JSON.stringify({
      seconds: result.result.lapSeconds === undefined
        ? null
        : Number(result.result.lapSeconds.toFixed(3)),
      maxLaneDistance: Number(result.result.maxLaneDistance.toFixed(3)),
      illegalSamples: result.result.illegalSamples,
      slideEvents: result.result.slideEvents,
    }));

    expect(result.legal).toBe(true);
    expect(result.result.lapSeconds).toBeDefined();
    expect(result.result.lapSeconds!).toBeLessThanOrEqual(25.72);
    expect(result.result.slideEvents).toBe(0);
  });

  it('keeps a small deterministic search as an optimizer smoke test', () => {
    installReferenceLineCalibration();
    const optimized = optimizePitwallJoint(
      OPTIMIZED_REFERENCE_LANES['pitwall-gp'],
      { maxEvaluations: 8, randomSeed: 0x51a7c0de },
    );

    expect(optimized.seed.legal).toBe(true);
    expect(optimized.best.legal).toBe(true);
    expect(optimized.best.result.lapSeconds).toBeDefined();
    expect(optimized.best.result.lapSeconds!).toBeLessThanOrEqual(optimized.seed.result.lapSeconds! + 1e-9);
    expect(optimized.evaluations).toBe(8);
  }, 15_000);
});
