import { describe, expect, it } from 'vitest';
import { LapValidityTracker, isEntireCarBeyondTrack } from './LapValidityModel';

describe('LapValidityModel', () => {
  it('counts a warning only when the whole car leaves the road', () => {
    expect(isEntireCarBeyondTrack(18.9, 0, 0)).toBe(false);
    expect(isEntireCarBeyondTrack(19.3, 0, 0)).toBe(true);
  });

  it('invalidates the lap on the third distinct full-car excursion', () => {
    const tracker = new LapValidityTracker();

    expect(tracker.sample(20, 0, 0)).toBe('WARNING');
    expect(tracker.sample(20.5, 0, 0)).toBe('NONE');
    tracker.sample(0, 0, 0);
    expect(tracker.sample(-20, 0, 0)).toBe('WARNING');
    tracker.sample(0, 0, 0);
    expect(tracker.sample(20, 0, 0)).toBe('INVALIDATED');

    expect(tracker.snapshot()).toEqual({
      warnings: 3,
      invalid: true,
      candidateEligible: false,
    });
  });

  it('keeps any off-track lap out of player racing-line candidates', () => {
    const tracker = new LapValidityTracker();
    tracker.sample(20, 0, 0);

    expect(tracker.invalid).toBe(false);
    expect(tracker.snapshot().candidateEligible).toBe(false);
  });
});
