// Shared physical/visual circuit dimensions. The centreline has been shrunk
// heavily for fast miniature laps, but the road is not scaled 1:1: it still
// needs to fit two arcade cars side by side and leave room for recovery.
export const TRACK_ROAD_HALF_WIDTH = 12;
export const TRACK_RUNOFF_HALF_WIDTH = 18;

// The kerb starts just outside the white line. A car may place the outside
// wheels on it without an immediate penalty, but a deeper cut still costs time.
export const TRACK_KERB_INNER_OFFSET = TRACK_ROAD_HALF_WIDTH + 0.12;
export const TRACK_KERB_OUTER_OFFSET = TRACK_ROAD_HALF_WIDTH + 2.10;
export const FREE_KERB_DISTANCE = TRACK_ROAD_HALF_WIDTH + 0.90;
export const DEEP_CUT_DISTANCE = TRACK_ROAD_HALF_WIDTH + 1.75;
export const FULL_GRASS_DISTANCE = TRACK_RUNOFF_HALF_WIDTH + 6;

// AI target centres need room for the ~2.15 m half-width physical collider.
export const AI_SAFE_LANE_LIMIT = TRACK_ROAD_HALF_WIDTH - 3.15;
