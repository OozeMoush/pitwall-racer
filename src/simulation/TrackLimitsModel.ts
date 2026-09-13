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

// Track limits are primarily physical. The wall sits beyond runoff so normal
// mistakes remain recoverable, but the segments are short enough that a car
// cannot thread through visible gaps at racing speed.
export const TRACK_BARRIER_OFFSET = TRACK_RUNOFF_HALF_WIDTH + 7;
export const TRACK_BARRIER_SEGMENT_LENGTH = 8;
export const TRACK_BARRIER_HALF_THICKNESS = 0.75;

// The old pit opening removed the outside barrier for almost a quarter of the
// lap. That effectively created an infield shortcut. Keep only two door-sized
// openings around the real pit entry and exit; everywhere else the same wall is
// both visible and physical, which naturally forms a pit wall along the straight.
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
  signedTurn: number,
  severity: number,
): boolean {
  if (!hasSafetyBarrier(progress, side)) return false;
  const inside = Math.abs(signedTurn) > 0.025 && side === Math.sign(signedTurn);

  // A literal constant-offset wall can fold over itself in only the very
  // sharpest miniature hairpins. Keep the inner wall through medium corners so
  // obvious straight-line cuts are physically closed, and omit it only where
  // the geometry would genuinely intrude onto the asphalt.
  if (inside && severity > 0.72) return false;
  return true;
}
