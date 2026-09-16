import { describe, expect, it } from 'vitest';
import {
  assessEmpiricalLap,
  calibratedPaceBenchmark,
  type EmpiricalLapEvidence,
} from './PaceBenchmarkModel';

function cleanLap(overrides: Partial<EmpiricalLapEvidence> = {}): EmpiricalLapEvidence {
  return {
    trackId: 'pitwall-gp',
    seconds: 24.342,
    compound: 'SOFT',
    startWear: 0.02,
    endWear: 0.08,
    deepCutRatio: 0,
    grassRatio: 0,
    maxTow: 0,
    launchAffected: false,
    recovered: false,
    pitted: false,
    ...overrides,
  };
}

describe('empirical pace benchmark calibration', () => {
  it('lets a verified runtime lap invalidate a slower solver machine limit', () => {
    const benchmark = calibratedPaceBenchmark('pitwall-gp', 26.691, [cleanLap()]);

    expect(benchmark.source).toBe('EMPIRICAL');
    expect(benchmark.seconds).toBe(24.342);
    expect(benchmark.physicsSeconds).toBe(26.691);
    expect(benchmark.solverGapSeconds).toBeCloseTo(2.349, 3);
  });

  it('never slows a physics reference that is already faster than empirical evidence', () => {
    const benchmark = calibratedPaceBenchmark('pitwall-gp', 23.9, [cleanLap()]);

    expect(benchmark.source).toBe('PHYSICS');
    expect(benchmark.seconds).toBe(23.9);
  });

  it('rejects a fast lap that used deep runoff or tow', () => {
    const cut = assessEmpiricalLap(cleanLap({ deepCutRatio: 0.012 }));
    const towed = assessEmpiricalLap(cleanLap({ maxTow: 0.12 }));

    expect(cut.eligibleForMachineLimit).toBe(false);
    expect(cut.reasons).toContain('DEEP_CUT');
    expect(towed.eligibleForMachineLimit).toBe(false);
    expect(towed.reasons).toContain('TOW');
  });

  it('keeps a heavily worn Soft lap as useful evidence but not a fresh machine-limit anchor', () => {
    const wornLap = cleanLap({ seconds: 26.225, startWear: 0.92, endWear: 1 });
    const assessment = assessEmpiricalLap(wornLap);
    const benchmark = calibratedPaceBenchmark('pitwall-gp', 26.691, [wornLap]);

    expect(assessment.eligibleForMachineLimit).toBe(false);
    expect(assessment.reasons).toContain('TYRE_NOT_FRESH');
    expect(benchmark.source).toBe('PHYSICS');
    expect(benchmark.seconds).toBe(26.691);
  });

  it('rejects recovered, pit, or launch-affected laps even when the time is plausible', () => {
    expect(assessEmpiricalLap(cleanLap({ recovered: true })).reasons).toContain('RECOVERY');
    expect(assessEmpiricalLap(cleanLap({ launchAffected: true })).reasons).toContain('LAUNCH_EFFECT');
    expect(assessEmpiricalLap(cleanLap({ pitted: true })).reasons).toContain('PIT_LAP');
  });
});
