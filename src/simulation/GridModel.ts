import { getActiveTrack, TRACK_LENGTH } from './TrackModel';

export interface GridSlot {
  progress: number;
  laneOffset: number;
}

// Keep a real stagger, but stop turning qualifying into a half-lap head start.
// The grid is expressed in metres so compact/long circuits get the same visual
// spacing. A smaller lane split also keeps P2 clear of Pitwall GP's pit-side
// wall while preserving two columns.
const GRID_FRONT_GAP_METRES = 9;
const GRID_LONGITUDINAL_STEP_METRES = 12;
const GRID_LANE_OFFSET = 4.2;
const GRID_SIZE = 8;

function activeGridConfig(): {
  frontGapMetres: number;
  longitudinalStepMetres: number;
  laneOffset: number;
} {
  const configured = getActiveTrack().grid;
  return {
    frontGapMetres: configured?.frontGapMetres ?? GRID_FRONT_GAP_METRES,
    longitudinalStepMetres:
      configured?.longitudinalStepMetres ?? GRID_LONGITUDINAL_STEP_METRES,
    laneOffset: configured?.laneOffset ?? GRID_LANE_OFFSET,
  };
}

export const PLAYER_GRID: GridSlot = {
  get progress() {
    return gridSlotForPosition(8).progress;
  },
  get laneOffset() {
    return gridSlotForPosition(8).laneOffset;
  },
};

export function gridSlotForPosition(position: number): GridSlot {
  const index = Math.max(0, Math.min(GRID_SIZE - 1, Math.round(position) - 1));
  const grid = activeGridConfig();
  const metresBehindLine =
    grid.frontGapMetres + grid.longitudinalStepMetres * index;
  return {
    progress: wrap01(1 - metresBehindLine / Math.max(1, TRACK_LENGTH)),
    laneOffset: index % 2 === 0 ? -grid.laneOffset : grid.laneOffset,
  };
}

export function gridPositionFor(
  id: string,
  order?: readonly string[],
): number | undefined {
  if (!order) return undefined;
  const index = order.indexOf(id);
  return index < 0 ? undefined : index + 1;
}

export function aiGridSlot(index: number): GridSlot {
  return gridSlotForPosition(index + 1);
}

export function gridLongitudinalGap(a: GridSlot, b: GridSlot): number {
  const raw = Math.abs(a.progress - b.progress);
  const circular = Math.min(raw, 1 - raw);
  return circular * TRACK_LENGTH;
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}
