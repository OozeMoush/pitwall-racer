import { describe, expect, it } from 'vitest';
import {
  RaceRacingLineCandidateFilter,
  normalizedRaceCandidateSpeed,
} from './RaceRacingLineCandidatePolicy';

describe('race racing-line candidate policy', () => {
  it('allows brief traffic but rejects a lap shaped by sustained traffic', () => {
    const filter = new RaceRacingLineCandidateFilter();
    for (let i = 0; i < 120; i++) filter.sampleTraffic(1 / 120, 0.08, 0, 0);
    expect(filter.eligible).toBe(true);

    for (let i = 0; i < 80; i++) filter.sampleTraffic(1 / 120, 0.08, 0, 0);
    expect(filter.eligible).toBe(false);
    expect(filter.affectedSeconds).toBeGreaterThan(1.5);
  });

  it('normalizes observed race speed to the lap-start grip context', () => {
    const raw = 55;
    const normalized = normalizedRaceCandidateSpeed(
      'pitwall-gp',
      0.42,
      raw,
      0.9,
      1.1,
    );

    expect(normalized).toBeGreaterThan(raw);
    expect(Number.isFinite(normalized)).toBe(true);
  });
});
