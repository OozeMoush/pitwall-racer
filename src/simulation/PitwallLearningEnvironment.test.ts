import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  evaluatePitwallLearningPolicy,
  comparePitwallLearningResults,
} from './PitwallLearningEnvironment';
import { createPitwallMachineTeacherPolicy } from './PitwallMachineTeacherPolicy';
import {
  applyPitwallResidual,
  createPitwallResidualPolicyData,
} from './PitwallResidualPolicy';

describe('Pitwall learning environment', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('replays the current machine-only teacher as a valid flying lap without off-track reward shaping', () => {
    const teacher = createPitwallMachineTeacherPolicy();
    const result = evaluatePitwallLearningPolicy(
      teacher,
      { captureFlyingLap: true },
    );

    console.log('PITWALL_LEARNING_TEACHER', JSON.stringify({
      status: result.status,
      invalidReason: result.invalidReason ?? null,
      seconds: result.lapSeconds === undefined ? null : Number(result.lapSeconds.toFixed(3)),
      forwardProgressMetres: Number(result.forwardProgressMetres.toFixed(1)),
      maxLaneDistance: Number(result.maxLaneDistance.toFixed(3)),
      peakSlideSeverity: Number(result.peakSlideSeverity.toFixed(3)),
      traceSamples: result.trace.length,
    }));

    expect(result.status).toBe('COMPLETED');
    expect(result.invalidReason).toBeUndefined();
    expect(result.lapSeconds).toBeDefined();
    expect(result.lapSeconds!).toBeLessThan(25.7);
    expect(result.trace.length).toBeGreaterThan(2500);
  }, 15_000);

  it('keeps a zero residual exactly on the verified teacher trajectory', () => {
    const teacher = createPitwallMachineTeacherPolicy();
    const residual = createPitwallResidualPolicyData();
    const result = evaluatePitwallLearningPolicy(
      (context) => applyPitwallResidual(
        teacher(context),
        context.projection.progress,
        residual,
      ),
    );

    expect(result.status).toBe('COMPLETED');
    expect(result.lapSeconds).toBeDefined();
    expect(result.lapSeconds!).toBeLessThanOrEqual(25.46);
    expect(result.maxLaneDistance).toBeLessThan(16);
  }, 15_000);

  it('orders completed laps by time rather than an off-track penalty score', () => {
    const base = {
      status: 'COMPLETED' as const,
      elapsedSeconds: 30,
      forwardProgressMetres: 4000,
      maxLaneDistance: 18,
      peakSlideSeverity: 0,
      trace: [],
    };
    const fast = { ...base, lapSeconds: 24.5 };
    const slow = { ...base, lapSeconds: 25.0 };
    expect(comparePitwallLearningResults(fast, slow)).toBeLessThan(0);
  });
});
