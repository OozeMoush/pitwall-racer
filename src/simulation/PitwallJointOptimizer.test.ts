import { describe, expect, it } from 'vitest';
import { optimizePitwallJoint } from './PitwallJointOptimizer';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

describe('Pitwall course-specific joint optimizer', () => {
  it('searches trajectory, speed and controls against one executable lap objective', () => {
    installReferenceLineCalibration();
    const optimized = optimizePitwallJoint(
      OPTIMIZED_REFERENCE_LANES['pitwall-gp'],
      { maxEvaluations: 18, passes: 1 },
    );

    console.log('PITWALL_JOINT_OPTIMIZER', JSON.stringify({
      seedSeconds: optimized.seed.result.lapSeconds === undefined
        ? null
        : Number(optimized.seed.result.lapSeconds.toFixed(3)),
      bestSeconds: optimized.best.result.lapSeconds === undefined
        ? null
        : Number(optimized.best.result.lapSeconds.toFixed(3)),
      bestMaxLaneDistance: Number(optimized.best.result.maxLaneDistance.toFixed(2)),
      evaluations: optimized.evaluations,
      accepted: optimized.accepted,
      genome: optimized.best.genome,
    }));

    expect(optimized.seed.legal).toBe(true);
    expect(optimized.best.legal).toBe(true);
    expect(optimized.best.score).toBeLessThanOrEqual(optimized.seed.score + 1e-9);
    expect(optimized.evaluations).toBeGreaterThan(1);
  }, 35_000);
});
