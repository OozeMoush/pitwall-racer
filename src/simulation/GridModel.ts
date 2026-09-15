import { TRACK_LENGTH } from './TrackModel';

export interface GridSlot {
  progress: number;
  laneOffset: number;
}

// Pitwall Racer is deliberately game-forward here: qualifying position should
// be an obvious race advantage on a ~25–30 second lap, not a cosmetic two-car
// row. Spread the eight starters over almost half a circuit while alternating
// lanes. Everyone still launches simultaneously and uses the same physics; a
// poor qualifying result simply has much more road to make back up.
const GRID_FRONT_PROGRESS = 0.992;
const GRID_PROGRESS_STEP = 0.070;
const GRID_LANE_OFFSET = 5.6;
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
    progress: Math.max(0.10, PLAYER_GRID.progress - GRID_PROGRESS_STEP * Math.max(1, index - 6)),
    laneOffset: index % 2 === 0 ? -GRID_LANE_OFFSET : GRID_LANE_OFFSET,
  };
}

export function gridLongitudinalGap(a: GridSlot, b: GridSlot): number {
  return Math.abs(a.progress - b.progress) * TRACK_LENGTH;
}
