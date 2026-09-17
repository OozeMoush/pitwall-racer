import { describe, expect, it } from 'vitest';
import {
  adamAscent,
  centeredRankUtilities,
  createAdamAscentState,
} from './PitwallEvolutionStrategy';

describe('Pitwall rank-based evolution math', () => {
  it('derives zero-sum utilities from ordering only', () => {
    const items = [8, 2, 5, 1];
    const utilities = centeredRankUtilities(items, (a, b) => a - b);
    const bestIndex = items.indexOf(1);
    const worstIndex = items.indexOf(8);

    expect(utilities[bestIndex]).toBeCloseTo(0.5, 12);
    expect(utilities[worstIndex]).toBeCloseTo(-0.5, 12);
    expect(utilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(0, 12);
  });

  it('moves parameters in the ascent-gradient direction with finite Adam state', () => {
    const state = createAdamAscentState(3);
    const next = adamAscent([0, 0, 0], [1, -2, 0], state, 0.01);
    expect(next[0]).toBeGreaterThan(0);
    expect(next[1]).toBeLessThan(0);
    expect(next[2]).toBe(0);
    expect(next.every(Number.isFinite)).toBe(true);
    expect(state.step).toBe(1);
  });
});
