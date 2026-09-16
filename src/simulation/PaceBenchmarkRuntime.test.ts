import { afterEach, describe, expect, it } from 'vitest';
import type { EmpiricalLapEvidence } from './PaceBenchmarkModel';
import {
  installPaceBenchmarkSession,
  resetPaceBenchmarkSession,
  sessionPaceBenchmarkSeconds,
  sessionPaceSpeedScale,
} from './PaceBenchmarkRuntime';

function cleanLap(seconds: number): EmpiricalLapEvidence {
  return {
    trackId: 'pitwall-gp',
    seconds,
    compound: 'SOFT',
    startWear: 0.02,
    endWear: 0.08,
    deepCutRatio: 0,
    grassRatio: 0,
    maxTow: 0,
    launchAffected: false,
    recovered: false,
    pitted: false,
  };
}

afterEach(() => resetPaceBenchmarkSession());

describe('session pace benchmark', () => {
  it('uses prior verified evidence and exposes a bounded speed-envelope scale', () => {
    installPaceBenchmarkSession('pitwall-gp', 26.691, [cleanLap(24.342)]);

    expect(sessionPaceBenchmarkSeconds('pitwall-gp', 26.691)).toBe(24.342);
    expect(sessionPaceSpeedScale('pitwall-gp')).toBeCloseTo(26.691 / 24.342, 4);
  });

  it('never lets an extreme or corrupt benchmark request more than 12% extra speed envelope', () => {
    installPaceBenchmarkSession('pitwall-gp', 26.691, [cleanLap(18)]);

    expect(sessionPaceSpeedScale('pitwall-gp')).toBe(1.12);
  });

  it('does not leak one circuit calibration into another circuit', () => {
    installPaceBenchmarkSession('pitwall-gp', 26.691, [cleanLap(24.342)]);

    expect(sessionPaceBenchmarkSeconds('velocity-park', 20)).toBe(20);
    expect(sessionPaceSpeedScale('velocity-park')).toBe(1);
  });
});
