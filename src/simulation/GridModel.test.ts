import { describe, expect, it } from 'vitest';
import {
  aiGridSlot,
  gridLongitudinalGap,
  gridPositionFor,
  gridSlotForPosition,
  PLAYER_GRID,
} from './GridModel';

describe('GridModel', () => {
  it('places every starter behind the start line', () => {
    const slots = Array.from({ length: 7 }, (_, index) => aiGridSlot(index));
    expect(PLAYER_GRID.progress).toBeGreaterThan(0.9);
    expect(PLAYER_GRID.progress).toBeLessThan(1);
    for (const slot of slots) {
      expect(slot.progress).toBeGreaterThan(PLAYER_GRID.progress);
      expect(slot.progress).toBeLessThan(1);
    }
  });

  it('keeps separate grid rows farther apart than one car length', () => {
    const front = aiGridSlot(0);
    const secondRow = aiGridSlot(2);
    expect(gridLongitudinalGap(front, secondRow)).toBeGreaterThan(20);
  });

  it('starts the legacy player fallback in P8 just behind and beside P7', () => {
    const p7 = aiGridSlot(6);
    expect(p7.progress).toBeGreaterThan(PLAYER_GRID.progress);
    expect(gridLongitudinalGap(p7, PLAYER_GRID)).toBeLessThan(5);
    expect(Math.abs(p7.laneOffset - PLAYER_GRID.laneOffset)).toBeGreaterThan(12);
  });

  it('maps a qualifying order to the matching physical grid slot', () => {
    const order = ['ai-2', 'player', 'ai-0', 'ai-1'];
    expect(gridPositionFor('player', order)).toBe(2);
    expect(gridPositionFor('ai-2', order)).toBe(1);
    expect(gridPositionFor('missing', order)).toBeUndefined();
    expect(gridSlotForPosition(2)).toEqual(aiGridSlot(1));
  });
});
