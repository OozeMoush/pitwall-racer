import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

/**
 * The offline coordinate-descent line is geometrically legal, but on Pitwall's
 * miniature S-sections it contains lane reversals that are too sharp for the
 * real 120 Hz rigid-body car to realize. The speed planner then scores a path
 * that the race AI cannot actually drive.
 *
 * Calibrate the baked line once, before any reference laps are cached. This is
 * deliberately a trajectory-only correction: no engine power, tyre grip or
 * straight-line speed is added. Broad outside/apex placement is preserved,
 * while the fast chicanes are treated as flowing arcs rather than a sequence of
 * full-width left-right lane targets.
 */
export function installReferenceLineCalibration(): void {
  const raw = OPTIMIZED_REFERENCE_LANES['pitwall-gp'];
  if (raw.length === 0 || isCalibrated(raw)) return;

  const smoothed = smoothCircular(raw, 2);
  const reachable = limitCircularLaneRate(smoothed, 1.35, 6);

  // The physical telemetry shows the biggest loss at roughly 55-65% and again
  // in the final complex: the car is still on the previous side of the road
  // when the raw optimizer has already demanded the opposite edge. A much
  // broader local average produces the same human-like result as straightening
  // a chicane: one continuous transition instead of chasing every local apex.
  const broad = smoothCircular(reachable, 14);
  const chicaneRounded = reachable.map((value, index) => {
    const progress = index / reachable.length;
    const technicalWeight = Math.max(
      windowWeight(progress, 0.500, 0.730, 0.035),
      windowWeight(progress, 0.815, 0.998, 0.035),
      windowWeight(progress, 0.000, 0.060, 0.028),
    );
    return lerp(value, broad[index], technicalWeight);
  });

  // Keep the centre path physically reachable at race speed. The final tiny
  // smoothing pass removes sample-to-sample kinks introduced by the window
  // blend without erasing the broad outside/inside/outside shape.
  const settled = limitCircularLaneRate(chicaneRounded, 0.90, 8);
  const finalLine = smoothCircular(settled, 3).map((value) => clamp(value, -14.2, 14.2));

  OPTIMIZED_REFERENCE_LANES['pitwall-gp'] = Object.freeze(markCalibrated(finalLine));
}

function smoothCircular(values: readonly number[], passes: number): number[] {
  let current = [...values];
  const weights = [1, 2, 3, 2, 1] as const;
  const divisor = weights.reduce((sum, weight) => sum + weight, 0);

  for (let pass = 0; pass < passes; pass++) {
    const source = current;
    current = source.map((_, index) => {
      let total = 0;
      for (let tap = 0; tap < weights.length; tap++) {
        const offset = tap - 2;
        total += source[wrap(index + offset, source.length)] * weights[tap];
      }
      return total / divisor;
    });
  }
  return current;
}

function limitCircularLaneRate(values: readonly number[], maximumStep: number, passes: number): number[] {
  const result = [...values];
  for (let pass = 0; pass < passes; pass++) {
    for (let index = 0; index < result.length; index++) {
      const next = (index + 1) % result.length;
      const delta = result[next] - result[index];
      const excess = Math.abs(delta) - maximumStep;
      if (excess <= 0) continue;
      const correction = Math.sign(delta) * excess * 0.5;
      result[index] += correction;
      result[next] -= correction;
    }
    for (let index = result.length - 1; index >= 0; index--) {
      const previous = wrap(index - 1, result.length);
      const delta = result[index] - result[previous];
      const excess = Math.abs(delta) - maximumStep;
      if (excess <= 0) continue;
      const correction = Math.sign(delta) * excess * 0.5;
      result[previous] += correction;
      result[index] -= correction;
    }
  }
  return result;
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

function markCalibrated(values: number[]): number[] {
  Object.defineProperty(values, '__pitwallCalibrated', { value: true });
  return values;
}

function isCalibrated(values: readonly number[]): boolean {
  return (values as readonly number[] & { __pitwallCalibrated?: boolean }).__pitwallCalibrated === true;
}

function wrap(index: number, length: number): number {
  return ((index % length) + length) % length;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
