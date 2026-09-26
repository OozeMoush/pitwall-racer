import { describe, expect, it } from 'vitest';
import {
  LapValidityTracker,
  TRACK_LIMIT_HALF_WIDTH,
  isEntireCarBeyondTrack,
} from './LapValidityModel';
import { TRACK_ROAD_HALF_WIDTH } from './TrackLimitsModel';

describe('LapValidityModel', () => {
  it('counts a warning only when all four visible tyres leave the road', () => {
    const edge = TRACK_ROAD_HALF_WIDTH + TRACK_LIMIT_HALF_WIDTH;
    expect(isEntireCarBeyondTrack(edge - 0.05, 0, 0)).toBe(false);
    expect(isEntireCarBeyondTrack(edge + 0.05, 0, 0)).toBe(true);
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
