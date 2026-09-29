import {
  TRACK_BARRIER_OFFSET,
  TRACK_BARRIER_SEGMENT_LENGTH,
  TRACK_ROAD_HALF_WIDTH,
  shouldPlaceSafetyBarrier,
} from './TrackLimitsModel';
import { trackProfile } from './TrackProfile';
import { projectTrack, sampleTrack, TRACK_LENGTH } from './TrackModel';

export interface SafetyBarrierSegment {
  side: -1 | 1;
  progress: number;
  x: number;
  y: number;
  heading: number;
  length: number;
}

const MIN_OTHER_ROAD_CLEARANCE = TRACK_ROAD_HALF_WIDTH + 5.15;
// The first chord-aligned pass removed the dangerous apex spikes, but ~6 m
// pieces can still read as a faceted polygon on this tiny circuit. Keep every
// physical/visual wall chord close to 3 m so curves look round and wall brushes
// do not meet a visibly sharp corner.
const MAX_BARRIER_CHORD_LENGTH = 2.25;

/**
 * Build wall pieces from chords between consecutive offset samples.
 *
 * Progress spacing alone is not enough: on the outside of a tight bend a 6 m
 * centreline interval can become a much longer wall interval. Each base
 * interval is therefore subdivided by the actual offset-path chord length
 * before creating the physical/visual wall pieces.
 */
export function safetyBarrierSegments(): SafetyBarrierSegment[] {
  const baseCount = Math.max(128, Math.ceil(TRACK_LENGTH / TRACK_BARRIER_SEGMENT_LENGTH));
  const segments: SafetyBarrierSegment[] = [];

  for (let index = 0; index < baseCount; index++) {
    const baseStart = index / baseCount;
    const baseEnd = (index + 1) / baseCount;

    for (const side of [-1, 1] as const) {
      appendBarrierInterval(segments, side, baseStart, baseEnd, 0);
    }
  }

  return segments;
}

const MAX_BARRIER_SUBDIVISION_DEPTH = 8;

function appendBarrierInterval(
  segments: SafetyBarrierSegment[],
  side: -1 | 1,
  startProgress: number,
  endProgress: number,
  depth: number,
): void {
  const start = sampleTrack(startProgress, side * TRACK_BARRIER_OFFSET);
  const end = sampleTrack(endProgress >= 1 ? 0 : endProgress, side * TRACK_BARRIER_OFFSET);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 0.2) return;

  // The rough end-to-end chord can underestimate the offset-path curvature.
  // Subdivide the actual candidate recursively so MAX_BARRIER_CHORD_LENGTH is
  // a real guarantee even on race-scale bends.
  if (length > MAX_BARRIER_CHORD_LENGTH && depth < MAX_BARRIER_SUBDIVISION_DEPTH) {
    const middle = (startProgress + endProgress) * 0.5;
    appendBarrierInterval(segments, side, startProgress, middle, depth + 1);
    appendBarrierInterval(segments, side, middle, endProgress, depth + 1);
    return;
  }

  const progress = (startProgress + endProgress) * 0.5;
  const profile = trackProfile(progress);
  if (!shouldPlaceSafetyBarrier(progress, side, profile.signedTurn, profile.severity)) return;

  const x = (start.x + end.x) * 0.5;
  const y = (start.y + end.y) * 0.5;
  const nearestTrack = projectTrack(x, y);
  if (nearestTrack.distance < MIN_OTHER_ROAD_CLEARANCE) return;

  segments.push({ side, progress, x, y, heading: Math.atan2(dy, dx), length });
}
