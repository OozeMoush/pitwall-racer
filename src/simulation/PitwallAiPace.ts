import type { TrackId } from './TrackModel';

/**
 * Pitwall's miniature direction-change complexes can be driven materially
 * faster than the conservative machine-limit reference because the arcade car
 * can exploit transient rotation and the full legal road. This is a target-
 * speed multiplier only: it does not change engine power, tyre grip, drag or
 * straight-line speed, and other circuits remain untouched.
 *
 * Human playtesting showed that the decisive gap is not top speed but how much
 * speed is carried while changing direction. Keep the extra pace concentrated
 * in technical sections and feather it in/out so the controller does not get a
 * sudden speed command at the window boundaries.
 */
export function competitiveCornerPaceMultiplier(
  trackId: TrackId,
  progress: number,
  severity: number,
  laneSwing: number,
): number {
  if (trackId !== 'pitwall-gp') return 1;

  const p = wrap01(progress);
  const technical = clamp((severity - 0.18) / 0.72, 0, 1);
  const directionChange = clamp((laneSwing - 0.8) / 6.2, 0, 1);

  // Mildly raise every genuine Pitwall corner so the physical controller does
  // not obediently reproduce the old conservative envelope. This still does
  // nothing on the long straights because technical ~= 0 there.
  const stableBase = technical * (0.18 + directionChange * 0.14);

  // The middle S/hairpin sequence is where a good player gains the largest
  // amount of time by committing to each apex and immediately preparing the
  // next direction change.
  const middleAttack = windowWeight(p, 0.44, 0.735, 0.04)
    * technical
    * (0.20 + directionChange * 0.10);

  // Carry more speed through the last complex so the car crosses the line with
  // momentum instead of sacrificing the first tenth of the next flying lap.
  const finalApproach = wrapWindowWeight(p, 0.79, 0.03, 0.035)
    * technical
    * (0.18 + directionChange * 0.08);

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

function wrapWindowWeight(progress: number, start: number, end: number, feather: number): number {
  const p = wrap01(progress);
  if (start <= end) return windowWeight(p, start, end, feather);
  return Math.max(
    windowWeight(p, start, 1, feather),
    windowWeight(p, 0, end, feather),
  );
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
