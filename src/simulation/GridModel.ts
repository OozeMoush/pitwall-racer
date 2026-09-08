import { TRACK_LENGTH } from './TrackModel';

export interface GridSlot {
  progress: number;
  laneOffset: number;
}

// Start/finish is progress 0. Every car begins behind it, in four staggered
// rows. P8 sits a fraction behind P7 so live classification is deterministic
// even before either car moves.
export const PLAYER_GRID: GridSlot = { progress: 0.9774, laneOffset: 8 };

const AI_GRID: readonly GridSlot[] = [
  { progress: 0.996, laneOffset: -8 },
  { progress: 0.996, laneOffset: 8 },
  { progress: 0.990, laneOffset: -8 },
  { progress: 0.990, laneOffset: 8 },
  { progress: 0.984, laneOffset: -8 },
  { progress: 0.984, laneOffset: 8 },
  { progress: 0.978, laneOffset: -8 },
];

export function aiGridSlot(index: number): GridSlot {
  return AI_GRID[index] ?? {
    progress: Math.max(0.94, PLAYER_GRID.progress - 0.006 * Math.max(0, index - AI_GRID.length + 1)),
    laneOffset: index % 2 === 0 ? -8 : 8,
  };
}

export function gridLongitudinalGap(a: GridSlot, b: GridSlot): number {
  return Math.abs(a.progress - b.progress) * TRACK_LENGTH;
}
