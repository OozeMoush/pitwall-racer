import { describe, expect, it } from 'vitest';
import { aiGridSlot, gridLongitudinalGap, PLAYER_GRID } from './GridModel';

describe('GridModel', () => {
  it('places every starter behind the start line', () => {
    const slots = Array.from({ length: 7 }, (_, index) => aiGridSlot(index));
    expect(PLAYER_GRID.progress).toBeGreaterThan(0.9);
    expect(PLAYER_GRID.progress).toBeLessThan(1);
    for (const slot of slots) {
      expect(slot.progress).toBeGreaterThan(PLAYER_GRID.progress - 0.001);
      expect(slot.progress).toBeLessThan(1);
    }
  });

  it('keeps separate grid rows farther apart than one car length', () => {
    const front = aiGridSlot(0);
    const secondRow = aiGridSlot(2);
    expect(gridLongitudinalGap(front, secondRow)).toBeGreaterThan(20);
  });

  it('starts the player in P8 beside the final AI row, not on top of it', () => {
    const p7 = aiGridSlot(6);
    expect(p7.progress).toBeCloseTo(PLAYER_GRID.progress, 6);
    expect(Math.abs(p7.laneOffset - PLAYER_GRID.laneOffset)).toBeGreaterThan(12);
  });
});
