import { describe, expect, it } from 'vitest';
import {
  aiGridSlot,
  gridLongitudinalGap,
  gridPositionFor,
  gridSlotForPosition,
  PLAYER_GRID,
} from './GridModel';
import { setActiveTrack } from './TrackModel';

describe('GridModel', () => {
  it('keeps all eight starters in a compact stagger immediately behind the line', () => {
    setActiveTrack('pitwall-gp');
    const slots = Array.from({ length: 8 }, (_, index) => gridSlotForPosition(index + 1));
    expect(slots[0].progress).toBeGreaterThan(0.99);
    expect(PLAYER_GRID.progress).toBeGreaterThan(0.94);
    for (let index = 0; index < slots.length; index++) {
      expect(slots[index].progress).toBeLessThan(1);
      if (index > 0) expect(slots[index - 1].progress).toBeGreaterThan(slots[index].progress);
    }
  });

  it('uses about twelve metres between consecutive grid positions instead of half a lap', () => {
    setActiveTrack('pitwall-gp');
    for (let index = 0; index < 7; index++) {
      const gap = gridLongitudinalGap(
        gridSlotForPosition(index + 1),
        gridSlotForPosition(index + 2),
      );
      expect(gap).toBeGreaterThan(10.5);
      expect(gap).toBeLessThan(13.5);
    }
    const spread = gridLongitudinalGap(
      gridSlotForPosition(1),
      gridSlotForPosition(8),
    );
    expect(spread).toBeGreaterThan(75);
    expect(spread).toBeLessThan(95);
  });

  it('alternates two safe lanes while preserving qualifying order', () => {
    setActiveTrack('pitwall-gp');
    for (let position = 1; position < 8; position++) {
      const front = gridSlotForPosition(position);
      const behind = gridSlotForPosition(position + 1);
      expect(Math.sign(front.laneOffset)).not.toBe(Math.sign(behind.laneOffset));
      expect(Math.abs(front.laneOffset)).toBeLessThan(5);
      expect(front.progress).toBeGreaterThan(behind.progress);
    }
  });

  it('keeps the fallback player in the P8 physical slot', () => {
    setActiveTrack('pitwall-gp');
    expect(PLAYER_GRID).toEqual(gridSlotForPosition(8));
    expect(aiGridSlot(6).progress).toBeGreaterThan(PLAYER_GRID.progress);
    expect(gridLongitudinalGap(aiGridSlot(6), PLAYER_GRID)).toBeGreaterThan(10);
  });

  it('maps a qualifying order to the matching physical grid slot', () => {
    const order = ['ai-2', 'player', 'ai-0', 'ai-1'];
    expect(gridPositionFor('player', order)).toBe(2);
    expect(gridPositionFor('ai-2', order)).toBe(1);
    expect(gridPositionFor('missing', order)).toBeUndefined();
    expect(gridSlotForPosition(2)).toEqual(aiGridSlot(1));
  });
});
