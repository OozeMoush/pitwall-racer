import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

/**
 * The offline coordinate-descent line is geometrically legal, but on Pitwall's
 * miniature S-section it contains lane reversals that are too sharp for the
 * real 120 Hz rigid-body car to realize. The speed planner then scores a path
 * that the race AI cannot actually drive.
 *
 * Calibrate the baked line once, before any reference laps are cached. This is
 * deliberately a trajectory-only correction: no engine power, tyre grip or
 * straight-line speed is added. Broad outside/apex placement is preserved,
 * while short left-right spikes are rounded into one continuous chicane arc.
 */
export function installReferenceLineCalibration(): void {
  const raw = OPTIMIZED_REFERENCE_LANES['pitwall-gp'];
  if (raw.length === 0 || isCalibrated(raw)) return;

  const smoothed = smoothCircular(raw, 2);
  const reachable = limitCircularLaneRate(smoothed, 1.55, 5);
  const finalLine = smoothCircular(reachable, 1).map((value) => clamp(value, -14.5, 14.5));

  // Keep the public shape readonly for every consumer just like the baked data.
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

// A non-enumerable array property survives Object.freeze and prevents repeated
// installation without changing any numeric samples or public data shape.
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
