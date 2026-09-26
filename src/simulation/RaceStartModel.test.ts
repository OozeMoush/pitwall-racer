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

  it('turns reaction advantage into a clearly visible short launch-performance gap', () => {
    const fast = evaluateLaunchReaction(0.16);
    const cpuBaseline = evaluateLaunchReaction(AI_START_REACTION_SECONDS);
    const slow = evaluateLaunchReaction(0.34);

    expect(cpuBaseline.accelerationMultiplier).toBeCloseTo(1, 8);
    expect(fast.accelerationMultiplier).toBeGreaterThan(1.07);
    expect(slow.accelerationMultiplier).toBeLessThan(0.86);
    expect(fast.accelerationMultiplier - slow.accelerationMultiplier).toBeGreaterThan(0.20);
  });

  it('reports the measured reaction and launch performance in the feedback', () => {
    const result = evaluateLaunchReaction(0.16);
    expect(result.label).toContain('160 ms');
    expect(result.label).toContain('LAUNCH');
  });
});
