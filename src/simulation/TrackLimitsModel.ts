import { DEFAULT_PIT_LANE_DEFINITION, getActiveTrack, TRACK_LENGTH } from './TrackModel';

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
// than at the far edge of the broad visual runoff. Shorter wall segments matter
// on the miniature layout: long tangent boxes overlap and poke into the next
// part of a tight bend, creating invisible snag points. Six-metre pieces track
// the curve much more closely while still forming an impassable wall for a car
// wider than the tiny seams between segments.
export const TRACK_BARRIER_OFFSET = TRACK_ROAD_HALF_WIDTH + 8.5;
export const TRACK_BARRIER_SEGMENT_LENGTH = 5.4;
export const TRACK_BARRIER_HALF_THICKNESS = 0.75;

// Keep the pit-side wall openings physical as circuits change scale. The old
// fixed progress windows worked on ~2 km layouts but left a solid wall across
// Pitwall GP 2.0's new entry at 0.985.
const PIT_BARRIER_OPENING_HALF_METRES = 48;

export function hasSafetyBarrier(progress: number, side: -1 | 1): boolean {
  if (side < 0) return true;

  const p = wrap01(progress);
  const pitLane = getActiveTrack().pitLane ?? DEFAULT_PIT_LANE_DEFINITION;
  const entry = wrap01(pitLane.entryProgress);
  const exit = wrap01(entry + pitLane.lengthMetres / Math.max(1, TRACK_LENGTH));
  const halfSpan = PIT_BARRIER_OPENING_HALF_METRES / Math.max(1, TRACK_LENGTH);

  const pitEntryOpening = circularProgressDistance(p, entry) <= halfSpan;
  const pitExitOpening = circularProgressDistance(p, exit) <= halfSpan;
  return !(pitEntryOpening || pitExitOpening);
}

function circularProgressDistance(a: number, b: number): number {
  const delta = Math.abs(wrap01(a - b));
  return Math.min(delta, 1 - delta);
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
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
