import { describe, expect, it } from 'vitest';
import { lapTyreLabel, liveTimingTone } from './LapRecordModel';

describe('lap record presentation', () => {
  it('marks the lap where the car changes compound in the pits', () => {
    expect(lapTyreLabel('MEDIUM', 'SOFT', true)).toBe('M→S PIT');
    expect(lapTyreLabel('HARD', 'HARD', false)).toBe('H');
  });

  it('re-evaluates a completed live sector when the session record changes later', () => {
    expect(liveTimingTone(30, 31, 30)).toBe('session-best');
    expect(liveTimingTone(30, 31, 29.8)).toBe('personal-best');
    expect(liveTimingTone(30, 29.5, 29.2)).toBe('neutral');
  });

  it('never treats a still-running sector clock as a personal or session best', () => {
    expect(liveTimingTone(8.4, 23.1, 22.9, false)).toBe('neutral');
  });
});
