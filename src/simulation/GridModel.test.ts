import { describe, expect, it } from 'vitest';
import {
  aiGridSlot,
  gridLongitudinalGap,
  gridPositionFor,
  gridSlotForPosition,
  PLAYER_GRID,
} from './GridModel';

describe('GridModel', () => {
  it('places every starter behind the start line in strict qualifying order', () => {
    const slots = Array.from({ length: 8 }, (_, index) => gridSlotForPosition(index + 1));
    expect(PLAYER_GRID.progress).toBeGreaterThan(0.9);
    expect(PLAYER_GRID.progress).toBeLessThan(1);
    for (let index = 0; index < slots.length; index++) {
      expect(slots[index].progress).toBeLessThan(1);
      if (index > 0) expect(slots[index - 1].progress).toBeGreaterThan(slots[index].progress);
    }
  });

  it('gives every qualifying position a clearly visible longitudinal advantage', () => {
    for (let index = 0; index < 7; index++) {
      expect(gridLongitudinalGap(aiGridSlot(index), gridSlotForPosition(index + 2))).toBeGreaterThan(12);
    }
    expect(gridLongitudinalGap(gridSlotForPosition(1), gridSlotForPosition(8))).toBeGreaterThan(90);
  });

  it('alternates grid lanes instead of putting adjacent qualifiers side by side', () => {
    for (let position = 1; position < 8; position++) {
      const front = gridSlotForPosition(position);
      const behind = gridSlotForPosition(position + 1);
      expect(Math.sign(front.laneOffset)).not.toBe(Math.sign(behind.laneOffset));
      expect(front.progress).toBeGreaterThan(behind.progress);
    }
  });

  it('keeps the legacy player fallback in the P8 physical slot', () => {
    expect(PLAYER_GRID).toEqual(gridSlotForPosition(8));
    expect(aiGridSlot(6).progress).toBeGreaterThan(PLAYER_GRID.progress);
    expect(gridLongitudinalGap(aiGridSlot(6), PLAYER_GRID)).toBeGreaterThan(12);
  });

  it('maps a qualifying order to the matching physical grid slot', () => {
    const order = ['ai-2', 'player', 'ai-0', 'ai-1'];
    expect(gridPositionFor('player', order)).toBe(2);
    expect(gridPositionFor('ai-2', order)).toBe(1);
    expect(gridPositionFor('missing', order)).toBeUndefined();
    expect(gridSlotForPosition(2)).toEqual(aiGridSlot(1));
  });
});
