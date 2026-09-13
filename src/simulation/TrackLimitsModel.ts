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

// Grass starts at the runoff edge and kills speed first. The wall is a second
// line of defence, not the track-limit rule itself. On a miniature hairpin the
// inside offset curve can have a radius smaller than the barrier offset; a
// literal continuous inside wall would then fold through the racing surface.
// Keep walls on both sides of straights/gentle turns, but omit the inside wall
// of tight turns. The outside wall remains physical and the inside grass still
// carries the full shortcut penalty.
export const TRACK_BARRIER_OFFSET = TRACK_RUNOFF_HALF_WIDTH + 7;
export const TRACK_BARRIER_SEGMENT_LENGTH = 10;
export const TRACK_BARRIER_HALF_THICKNESS = 0.75;

const PIT_BARRIER_GAP_START = 0.875;
const PIT_BARRIER_GAP_END = 0.115;

export function hasSafetyBarrier(progress: number, side: -1 | 1): boolean {
  const p = ((progress % 1) + 1) % 1;
  if (side < 0) return true;
  return !(p >= PIT_BARRIER_GAP_START || p <= PIT_BARRIER_GAP_END);
}

export function shouldPlaceSafetyBarrier(
  progress: number,
  side: -1 | 1,
  signedTurn: number,
  severity: number,
): boolean {
  if (!hasSafetyBarrier(progress, side)) return false;
  const inside = Math.abs(signedTurn) > 0.025 && side === Math.sign(signedTurn);
  if (inside && severity > 0.42) return false;
  return true;
}
