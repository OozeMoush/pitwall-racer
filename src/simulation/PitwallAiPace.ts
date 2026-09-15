import type { TrackId } from './TrackModel';

/**
 * Pitwall's miniature direction-change complexes can be driven materially
 * faster than the conservative machine-limit reference because the arcade car
 * can exploit transient rotation and the full legal road. This is a target-
 * speed multiplier only: it does not change engine power, tyre grip, drag or
 * straight-line speed, and other circuits remain untouched.
 */
export function competitiveCornerPaceMultiplier(
  trackId: TrackId,
  severity: number,
  laneSwing: number,
): number {
  if (trackId !== 'pitwall-gp') return 1;
  const technical = clamp((severity - 0.22) / 0.70, 0, 1);
  const directionChange = clamp((laneSwing - 1.0) / 6.0, 0, 1);
  return 1 + technical * (0.14 + directionChange * 0.12);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
