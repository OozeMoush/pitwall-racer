import { TRACK_LENGTH } from './TrackModel';

export interface GridSlot {
  progress: number;
  laneOffset: number;
}

// The miniature lap is much shorter, so progress gaps must be larger to keep
// physical grid rows separated by roughly two car lengths.
const GRID_SLOTS: readonly GridSlot[] = [
  { progress: 0.994, laneOffset: -6 },
  { progress: 0.994, laneOffset: 6 },
  { progress: 0.984, laneOffset: -6 },
  { progress: 0.984, laneOffset: 6 },
  { progress: 0.974, laneOffset: -6 },
  { progress: 0.974, laneOffset: 6 },
  { progress: 0.964, laneOffset: -6 },
  { progress: 0.9625, laneOffset: 6 },
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
    progress: Math.max(0.91, PLAYER_GRID.progress - 0.010 * Math.max(0, index - 6)),
    laneOffset: index % 2 === 0 ? -6 : 6,
  };
}

export function gridLongitudinalGap(a: GridSlot, b: GridSlot): number {
  return Math.abs(a.progress - b.progress) * TRACK_LENGTH;
}
