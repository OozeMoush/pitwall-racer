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

// Normal safety wall lives beyond runoff. On very tight inside corners the
// same constant offset would geometrically fold across the miniature circuit,
// so use a closer anti-cut wall just beyond the kerb instead of deleting the
// wall entirely. That preserves a legal kerb attack but makes chicane/infield
// straight-lining physically impossible without a penalty system.
export const TRACK_BARRIER_OFFSET = TRACK_RUNOFF_HALF_WIDTH + 7;
export const TRACK_ANTI_CUT_BARRIER_OFFSET = TRACK_ROAD_HALF_WIDTH + 5.2;
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

/**
 * Returns the physical/rendered wall offset for this piece of circuit.
 * undefined means the intentional pit-lane door. Tight inside turns get the
 * closer anti-cut wall; all other sections retain the runoff safety wall.
 */
export function safetyBarrierOffset(
  progress: number,
  side: -1 | 1,
  signedTurn: number,
  severity: number,
): number | undefined {
  if (!hasSafetyBarrier(progress, side)) return undefined;
  const inside = Math.abs(signedTurn) > 0.025 && side === Math.sign(signedTurn);
  if (inside && severity > 0.72) return TRACK_ANTI_CUT_BARRIER_OFFSET;
  return TRACK_BARRIER_OFFSET;
}

export function shouldPlaceSafetyBarrier(
  progress: number,
  side: -1 | 1,
  signedTurn: number,
  severity: number,
): boolean {
  return safetyBarrierOffset(progress, side, signedTurn, severity) !== undefined;
}
