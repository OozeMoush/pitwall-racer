// Shared physical/visual circuit dimensions. Keeping these in simulation space
// prevents the renderer from showing a road that the surface model treats as a
// different width.
export const TRACK_ROAD_HALF_WIDTH = 16;
export const TRACK_RUNOFF_HALF_WIDTH = 25;

// The kerb starts just outside the white line. A car may place the outside
// wheels on it without an immediate penalty, but once the centre moves far
// enough out that the whole car is effectively beyond the line, the penalty
// ramps quickly.
export const TRACK_KERB_INNER_OFFSET = TRACK_ROAD_HALF_WIDTH + 0.15;
export const TRACK_KERB_OUTER_OFFSET = TRACK_ROAD_HALF_WIDTH + 2.65;
export const FREE_KERB_DISTANCE = TRACK_ROAD_HALF_WIDTH + 1.15;
export const DEEP_CUT_DISTANCE = TRACK_ROAD_HALF_WIDTH + 2.20;
export const FULL_GRASS_DISTANCE = TRACK_RUNOFF_HALF_WIDTH + 8;

// AI target centres need room for the ~2.15 m half-width physical collider.
export const AI_SAFE_LANE_LIMIT = TRACK_ROAD_HALF_WIDTH - 3.15;
