import { afterEach, describe, expect, it } from 'vitest';
import { referenceTarget } from './ReferenceDriverModel';
import { activeReferenceTarget, setRuntimeRacingLine } from './RacingLineRuntime';

afterEach(() => {
  setRuntimeRacingLine('pitwall-gp', undefined);
});

describe('RacingLineRuntime', () => {
  it('uses the normal machine reference when no override is active', () => {
    const expected = referenceTarget('pitwall-gp', 0.37, 1.1);
    const actual = activeReferenceTarget('pitwall-gp', 0.37, 1.1);
    expect(actual.laneOffset).toBeCloseTo(expected.laneOffset);
    expect(actual.targetSpeed).toBeCloseTo(expected.targetSpeed);
  });

  it('lets a selected asset own lane placement and relative speed intent', () => {
    const grip = 1.1;
    const baseline = referenceTarget('pitwall-gp', 0.25, grip);
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 4 }, (_, index) => ({
        progress: index / 4,
        laneOffset: 4,
        targetSpeed: baseline.targetSpeed * 0.9,
      })),
    });

    const target = activeReferenceTarget('pitwall-gp', 0.25, grip);
    expect(target.laneOffset).toBeCloseTo(4);
    expect(target.targetSpeed).toBeLessThan(baseline.targetSpeed);
  });
});
