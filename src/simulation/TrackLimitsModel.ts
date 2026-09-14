// Shared physical/visual circuit dimensions. The centreline is miniature, but
// the road deliberately remains generous enough for two-car racing and for the
// faster arcade steering line to breathe through the tighter-radius corners.
export const TRACK_ROAD_HALF_WIDTH = 17;
export const TRACK_RUNOFF_HALF_WIDTH = 27;

// The kerb starts just outside the white line. A car may place the outside
// wheels on it without an immediate penalty, but a deeper cut still costs time.
export const TRACK_KERB_INNER_OFFSET = TRACK_ROAD_HALF_WIDTH + 0.12;
export const TRACK_KERB_OUTER_OFFSET = TRACK_ROAD_HALF_WIDTH + 2.35;
export const FREE_KERB_DISTANCE = TRACK_ROAD_HALF_WIDTH + 0.95;
export const DEEP_CUT_DISTANCE = TRACK_ROAD_HALF_WIDTH + 1.90;
export const FULL_GRASS_DISTANCE = TRACK_RUNOFF_HALF_WIDTH;

// AI target centres need room for the ~2.15 m half-width physical collider.
export const AI_SAFE_LANE_LIMIT = TRACK_ROAD_HALF_WIDTH - 3.15;

// This game does not use time penalties for cutting, so the legal circuit must
// be enforced physically. Keep the continuous wall just beyond the kerb rather
// than at the far edge of the broad visual runoff. The old 34 m offset was also
// larger than the radius of the miniature hairpins, forcing us to delete inner
// walls exactly where chicane shortcuts were most valuable. At 23.5 m the wall
// still leaves useful escape space beyond the white line, follows tight geometry
// without folding across the road, and clears the renderer/physics road-safety
// filter with margin.
export const TRACK_BARRIER_OFFSET = TRACK_ROAD_HALF_WIDTH + 6.5;
export const TRACK_BARRIER_SEGMENT_LENGTH = 8;
export const TRACK_BARRIER_HALF_THICKNESS = 0.75;

// Keep only two door-sized openings around the actual pit entry and exit.
const PIT_ENTRY_GAP_START = 0.898;
const PIT_ENTRY_GAP_END = 0.924;
const PIT_EXIT_GAP_START = 0.056;
const PIT_EXIT_GAP_END = 0.087;

export function hasSafetyBarrier(progress: number, side: -1 | 1): boolean {
  const p = ((progress % 1) + 1) % 1;
  if (side < 0) return true;
  const pitEntryOpening = p >= PIT_ENTRY_GAP_START && p <= PIT_ENTRY_GAP_END;
  const pitExitOpening = p >= PIT_EXIT_GAP_START && p <= PIT_EXIT_GAP_END;
  return !(pitEntryOpening || pitExitOpening);
}

export function shouldPlaceSafetyBarrier(
  progress: number,
  side: -1 | 1,
  _signedTurn: number,
  _severity: number,
): boolean {
  // The closer offset no longer folds over the miniature hairpins, so do not
  // punch exploitable holes into chicanes. Pit entry/exit are the only gaps.
  return hasSafetyBarrier(progress, side);
}
