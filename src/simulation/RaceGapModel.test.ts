import { describe, expect, it } from 'vitest';
import { formatRaceGap, raceGapSeconds } from './RaceGapModel';

describe('RaceGapModel', () => {
  it('converts track progress into a stable time interval', () => {
    const player = { lap: 5, progress: 0.40 };
    const ahead = { lap: 5, progress: 0.42 };
    expect(raceGapSeconds(player, ahead, 50)).toBeCloseTo(1, 6);
  });

  it('keeps the same interval through a lap wrap', () => {
    const player = { lap: 5, progress: 0.99 };
    const ahead = { lap: 6, progress: 0.01 };
    expect(raceGapSeconds(player, ahead, 50)).toBeCloseTo(1, 6);
  });

  it('formats battle gaps at a glance', () => {
    expect(formatRaceGap(0.84)).toBe('0.8s');
    expect(formatRaceGap(12.35)).toBe('12.3s');
  });
});
