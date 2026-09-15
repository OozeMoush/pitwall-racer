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

/**
 * Build wall pieces from the chord between consecutive offset samples.
 *
 * A tangent box at the midpoint can poke back into a tight hairpin even when
 * its centre is safely outside the road. Chord-aligned pieces stay inside the
 * intended wall curve, removing those apex snag points while keeping the same
 * physical track-limit policy.
 */
export function safetyBarrierSegments(): SafetyBarrierSegment[] {
  const segmentCount = Math.max(128, Math.ceil(TRACK_LENGTH / TRACK_BARRIER_SEGMENT_LENGTH));
  const segments: SafetyBarrierSegment[] = [];

  for (let index = 0; index < segmentCount; index++) {
    const startProgress = index / segmentCount;
    const endProgress = (index + 1) / segmentCount;
    const progress = (index + 0.5) / segmentCount;
    const profile = trackProfile(progress);

    for (const side of [-1, 1] as const) {
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

  return segments;
}
