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

// The visual barrier used to be scenery only, which made crossing the grass a
// viable shortcut. Grass now starts at the runoff edge and kills speed first;
// the wall sits a few metres farther out so tight miniature track sections do
// not accidentally collide with a neighbouring section of circuit.
export const TRACK_BARRIER_OFFSET = TRACK_RUNOFF_HALF_WIDTH + 7;
export const TRACK_BARRIER_SEGMENT_LENGTH = 10;
export const TRACK_BARRIER_HALF_THICKNESS = 0.75;

// The pit lane lives on the positive-offset side and runs from roughly 91% of
// the lap through the start line to 7.5%. Leave that side open through the pit
// corridor; the opposite-side wall remains continuous.
const PIT_BARRIER_GAP_START = 0.875;
const PIT_BARRIER_GAP_END = 0.115;

export function hasSafetyBarrier(progress: number, side: -1 | 1): boolean {
  const p = ((progress % 1) + 1) % 1;
  if (side < 0) return true;
  return !(p >= PIT_BARRIER_GAP_START || p <= PIT_BARRIER_GAP_END);
}
