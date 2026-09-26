import { describe, expect, it } from 'vitest';
import {
  AI_START_REACTION_SECONDS,
  evaluateLaunchReaction,
} from './RaceStartModel';

describe('RaceStartModel', () => {
  it('grades lights-out reaction time instead of preloading launch charge', () => {
    expect(evaluateLaunchReaction(0.16).quality).toBe('GREAT');
    expect(evaluateLaunchReaction(0.22).quality).toBe('GOOD');
    expect(evaluateLaunchReaction(0.34).quality).toBe('OK');
    expect(evaluateLaunchReaction(0.52).quality).toBe('SLOW');
  });

  it('uses a competitive CPU reaction benchmark near a normal human response', () => {
    expect(AI_START_REACTION_SECONDS).toBeGreaterThan(0.18);
    expect(AI_START_REACTION_SECONDS).toBeLessThan(0.30);
  });

  it('reports the measured reaction in milliseconds', () => {
    expect(evaluateLaunchReaction(0.237).label).toContain('237 ms');
  });
});
