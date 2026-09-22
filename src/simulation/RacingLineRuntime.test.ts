import { afterEach, describe, expect, it } from 'vitest';
import { referenceTarget } from './ReferenceDriverModel';
import {
  activeReferenceTarget,
  racingLineBrakeIntent,
  racingLineThrottleIntent,
  setRuntimeRacingLine,
} from './RacingLineRuntime';

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

  it('derives early braking from a player speed profile instead of the old machine brake trace', () => {
    const grip = 1.1;
    const points = Array.from({ length: 160 }, (_, index) => {
      const progress = index / 160;
      return {
        progress,
        laneOffset: 0,
        targetSpeed: progress >= 0.34 && progress <= 0.48 ? 34 : 82,
      };
    });
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points,
    });

    const brake = racingLineBrakeIntent('pitwall-gp', 0.30, grip, 82);
    expect(brake).toBeGreaterThan(0.15);
  });

  it('derives sustaining throttle from a flat explicit speed trace', () => {
    const grip = 1.1;
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 160 }, (_, index) => ({
        progress: index / 160,
        laneOffset: 0,
        targetSpeed: 72,
      })),
    });

    const throttle = racingLineThrottleIntent(
      'pitwall-gp',
      0.25,
      grip,
      72,
      0,
    );
    expect(throttle).toBeGreaterThan(0.05);
    expect(throttle).toBeLessThan(1);
  });

  it('preserves the demonstrated player speed at the grip where it was recorded', () => {
    const grip = 1.1;
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 160 }, (_, index) => ({
        progress: index / 160,
        laneOffset: 0,
        targetSpeed: 34,
      })),
    });

    const target = activeReferenceTarget('pitwall-gp', 0.37, grip);
    expect(target.targetSpeed).toBeCloseTo(34, 6);
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
