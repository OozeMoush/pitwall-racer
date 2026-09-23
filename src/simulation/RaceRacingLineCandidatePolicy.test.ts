import { describe, expect, it } from 'vitest';
import { RaceRacingLineCandidateFilter } from './RaceRacingLineCandidatePolicy';

describe('race racing-line candidate policy', () => {
  it('allows pure tow even when it lasts for most of a lap', () => {
    const filter = new RaceRacingLineCandidateFilter();
    for (let i = 0; i < 2400; i++) {
      filter.sampleTraffic(1 / 120, 0.08, 0, 0);
    }
    expect(filter.eligible).toBe(true);
    expect(filter.affectedSeconds).toBe(0);
  });

  it('rejects a lap shaped by sustained dirty air or close battle pressure', () => {
    const filter = new RaceRacingLineCandidateFilter();
    for (let i = 0; i < 120; i++) {
      filter.sampleTraffic(1 / 120, 0, 0.03, 0);
    }
    expect(filter.eligible).toBe(true);

    for (let i = 0; i < 80; i++) {
      filter.sampleTraffic(1 / 120, 0, 0, 0.4);
    }
    expect(filter.eligible).toBe(false);
    expect(filter.affectedSeconds).toBeGreaterThan(1.5);
  });


});
