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
const MAX_BARRIER_CHORD_LENGTH = 3.5;

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
      const roughStart = sampleTrack(baseStart, side * TRACK_BARRIER_OFFSET);
      const roughEnd = sampleTrack(baseEnd >= 1 ? 0 : baseEnd, side * TRACK_BARRIER_OFFSET);
      const roughLength = Math.hypot(roughEnd.x - roughStart.x, roughEnd.y - roughStart.y);
      const subdivisionCount = Math.max(1, Math.ceil(roughLength / MAX_BARRIER_CHORD_LENGTH));

      for (let sub = 0; sub < subdivisionCount; sub++) {
        const startProgress = baseStart + (baseEnd - baseStart) * (sub / subdivisionCount);
        const endProgress = baseStart + (baseEnd - baseStart) * ((sub + 1) / subdivisionCount);
        const progress = (startProgress + endProgress) * 0.5;
        const profile = trackProfile(progress);
        if (!shouldPlaceSafetyBarrier(progress, side, profile.signedTurn, profile.severity)) continue;

        const start = sampleTrack(startProgress, side * TRACK_BARRIER_OFFSET);
        const end = sampleTrack(endProgress >= 1 ? 0 : endProgress, side * TRACK_BARRIER_OFFSET);
        const x = (start.x + end.x) * 0.5;
        const y = (start.y + end.y) * 0.5;
        const nearestTrack = projectTrack(x, y);
        if (nearestTrack.distance < MIN_OTHER_ROAD_CLEARANCE) continue;

        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length < 0.2) continue;

        segments.push({ side, progress, x, y, heading: Math.atan2(dy, dx), length });
      }
    }
  }

  return segments;
}
