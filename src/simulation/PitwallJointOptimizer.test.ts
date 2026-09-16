import { describe, expect, it } from 'vitest';
import { optimizePitwallJoint } from './PitwallJointOptimizer';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

describe('Pitwall course-specific joint optimizer', () => {
  it('searches trajectory, speed and controls together against one executable lap objective', () => {
    installReferenceLineCalibration();
    const optimized = optimizePitwallJoint(
      OPTIMIZED_REFERENCE_LANES['pitwall-gp'],
      { maxEvaluations: 48, randomSeed: 0x51a7c0de },
    );

    console.log('PITWALL_JOINT_OPTIMIZER', JSON.stringify({
      seedSeconds: optimized.seed.result.lapSeconds === undefined
        ? null
        : Number(optimized.seed.result.lapSeconds.toFixed(3)),
      bestSeconds: optimized.best.result.lapSeconds === undefined
        ? null
        : Number(optimized.best.result.lapSeconds.toFixed(3)),
      bestMaxLaneDistance: Number(optimized.best.result.maxLaneDistance.toFixed(3)),
      guideSeconds: optimized.guide.result.lapSeconds === undefined
        ? null
        : Number(optimized.guide.result.lapSeconds.toFixed(3)),
      guideLegal: optimized.guide.legal,
      guideMaxLaneDistance: Number(optimized.guide.result.maxLaneDistance.toFixed(3)),
      evaluations: optimized.evaluations,
      accepted: optimized.accepted,
      genome: optimized.best.genome,
    }));

    expect(optimized.seed.legal).toBe(true);
    expect(optimized.best.legal).toBe(true);
    expect(optimized.best.result.lapSeconds).toBeDefined();
    expect(optimized.best.result.lapSeconds!).toBeLessThanOrEqual(optimized.seed.result.lapSeconds! + 1e-9);
    expect(optimized.evaluations).toBe(48);
  }, 55_000);
});
