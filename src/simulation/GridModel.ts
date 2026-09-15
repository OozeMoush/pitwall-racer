import { TRACK_LENGTH } from './TrackModel';

export interface GridSlot {
  progress: number;
  laneOffset: number;
}

// Qualifying should visibly matter in a game this short. Do not put P1/P2 on
// the same virtual row: every grid position is staggered longitudinally, while
// the lane still alternates like an F1 grid. On Pitwall this is roughly 15 m
// from one position to the next, enough that pole owns the launch into T1
// instead of instantly becoming a side-by-side lottery.
const GRID_FRONT_PROGRESS = 0.994;
const GRID_PROGRESS_STEP = 0.0075;
const GRID_LANE_OFFSET = 6.2;
const GRID_SLOTS: readonly GridSlot[] = Array.from({ length: 8 }, (_, index) => ({
  progress: GRID_FRONT_PROGRESS - GRID_PROGRESS_STEP * index,
  laneOffset: index % 2 === 0 ? -GRID_LANE_OFFSET : GRID_LANE_OFFSET,
}));

export const PLAYER_GRID: GridSlot = GRID_SLOTS[7];

export function gridSlotForPosition(position: number): GridSlot {
  const index = Math.max(0, Math.min(GRID_SLOTS.length - 1, Math.round(position) - 1));
  return GRID_SLOTS[index];
}

export function gridPositionFor(id: string, order?: readonly string[]): number | undefined {
  if (!order) return undefined;
  const index = order.indexOf(id);
  return index < 0 ? undefined : index + 1;
}

export function aiGridSlot(index: number): GridSlot {
  return GRID_SLOTS[index] ?? {
    progress: Math.max(0.90, PLAYER_GRID.progress - GRID_PROGRESS_STEP * Math.max(1, index - 6)),
    laneOffset: index % 2 === 0 ? -GRID_LANE_OFFSET : GRID_LANE_OFFSET,
  };
}

export function gridLongitudinalGap(a: GridSlot, b: GridSlot): number {
  return Math.abs(a.progress - b.progress) * TRACK_LENGTH;
}
