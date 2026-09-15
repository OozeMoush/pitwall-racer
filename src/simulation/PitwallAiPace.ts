import type { TrackId } from './TrackModel';

/**
 * Pitwall's miniature direction-change complexes can be driven materially
 * faster than the conservative machine-limit reference because the arcade car
 * can exploit transient rotation and the full legal road. This is a target-
 * speed multiplier only: it does not change engine power, tyre grip, drag or
 * straight-line speed, and other circuits remain untouched.
 *
 * The boost is deliberately progress-aware. Telemetry showed that the middle
 * S-sections remain composed with substantially more corner speed, while an
 * equally large boost in the final 10% makes the car cross to the wrong side of
 * the last chicane and *lose* time. Spend the pace budget where the physical car
 * can actually convert it into lap time instead of raising every corner target.
 */
export function competitiveCornerPaceMultiplier(
  trackId: TrackId,
  progress: number,
  severity: number,
  laneSwing: number,
): number {
  if (trackId !== 'pitwall-gp') return 1;

  const p = wrap01(progress);
  const technical = clamp((severity - 0.22) / 0.70, 0, 1);
  const directionChange = clamp((laneSwing - 1.0) / 6.0, 0, 1);
  const stableBase = technical * (0.14 + directionChange * 0.12);

  const middleAttack = windowWeight(p, 0.47, 0.73, 0.035)
    * technical
    * (0.14 + directionChange * 0.07);

  const finalApproach = windowWeight(p, 0.79, 0.895, 0.025)
    * technical
    * (0.11 + directionChange * 0.05);

  return 1 + stableBase + middleAttack + finalApproach;
}

function windowWeight(progress: number, start: number, end: number, feather: number): number {
  if (progress >= start && progress <= end) return 1;
  if (progress >= start - feather && progress < start) {
    return smoothstep((progress - (start - feather)) / feather);
  }
  if (progress > end && progress <= end + feather) {
    return 1 - smoothstep((progress - end) / feather);
  }
  return 0;
}

function smoothstep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
