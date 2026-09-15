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
 * equally large boost throughout the final 10% makes the car cross to the wrong
 * side of the last chicane. Attack the final apex only moderately, then release
 * the car on exit so it crosses the line with speed instead of finishing the
 * corner as a separate stop-start event.
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

  // A smaller final-apex increment is enough to lift the 90-95% minimum speed
  // without reproducing the unstable +45% experiment.
  const finalApex = windowWeight(p, 0.885, 0.955, 0.018)
    * technical
    * (0.055 + directionChange * 0.035);

  // The generated envelope stays cautious after the last rotation and therefore
  // leaves the AI accelerating from too low a speed across start/finish. Once
  // the final apex is behind it, ask for a clean release. This only changes the
  // pedal target; the shared engine still determines the actual acceleration.
  const finalExit = windowWeight(p, 0.945, 0.999, 0.012)
    * (0.075 + directionChange * 0.025);

  return 1 + stableBase + middleAttack + finalApproach + finalApex + finalExit;
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
