import { TRACK_LENGTH } from './TrackModel';

export interface GridSlot {
  progress: number;
  laneOffset: number;
}

// Start/finish is progress 0. P1 starts closest to the line and rows are
// staggered by side. PLAYER_GRID remains the legacy P8 fallback so older tests
// and direct race launches keep their previous behaviour when no qualifying
// order is supplied.
const GRID_SLOTS: readonly GridSlot[] = [
  { progress: 0.996, laneOffset: -8 },
  { progress: 0.996, laneOffset: 8 },
  { progress: 0.990, laneOffset: -8 },
  { progress: 0.990, laneOffset: 8 },
  { progress: 0.984, laneOffset: -8 },
  { progress: 0.984, laneOffset: 8 },
  { progress: 0.978, laneOffset: -8 },
  { progress: 0.9774, laneOffset: 8 },
];

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
    progress: Math.max(0.94, PLAYER_GRID.progress - 0.006 * Math.max(0, index - 6)),
    laneOffset: index % 2 === 0 ? -8 : 8,
  };
}

export function gridLongitudinalGap(a: GridSlot, b: GridSlot): number {
  return Math.abs(a.progress - b.progress) * TRACK_LENGTH;
}
