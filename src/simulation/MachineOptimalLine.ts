import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';

const LINE_MARGIN = 0.25;

interface LineBump {
  center: number;
  delta: number;
  halfWidth: number;
}

/**
 * Executable trajectory found by full-state machine search on Pitwall GP.
 *
 * The search started from the runtime-calibrated machine reference and scored
 * every candidate by actually driving the same 120 Hz chassis recurrence. No
 * human lap, target time, or telemetry contributed to these deformations.
 *
 * Keep the transformation list rather than a second opaque 320-number dump for
 * now. That makes the provenance inspectable while longitudinal/trajectory
 * optimization is still converging. Once the optimum stabilizes we can bake the
 * final 320-sample line in one deterministic artifact.
 */
const PITWALL_EXECUTABLE_BUMPS: readonly LineBump[] = [
  { center: 0.4846, delta: -3.00, halfWidth: 0.055 },
  { center: 0.5046, delta: -3.00, halfWidth: 0.055 },
  { center: 0.5246, delta: -3.00, halfWidth: 0.055 },
  { center: 0.5446, delta:  3.00, halfWidth: 0.055 },
  { center: 0.5646, delta:  3.00, halfWidth: 0.055 },
  { center: 0.5846, delta: -3.00, halfWidth: 0.055 },
  { center: 0.8518, delta: -1.80, halfWidth: 0.055 },
  { center: 0.8918, delta:  1.80, halfWidth: 0.055 },
  { center: 0.9118, delta:  1.80, halfWidth: 0.055 },
  { center: 0.9318, delta: -1.80, halfWidth: 0.055 },
  { center: 0.9518, delta: -1.80, halfWidth: 0.055 },
  { center: 0.8540, delta: -1.00, halfWidth: 0.055 },
  { center: 0.8940, delta:  1.00, halfWidth: 0.055 },
  { center: 0.9140, delta:  1.00, halfWidth: 0.055 },
  { center: 0.9540, delta: -1.00, halfWidth: 0.055 },
  { center: 0.5000, delta:  1.35, halfWidth: 0.042 },
  { center: 0.5400, delta:  1.35, halfWidth: 0.042 },
  { center: 0.5800, delta: -1.35, halfWidth: 0.042 },
  { center: 0.6200, delta: -1.35, halfWidth: 0.042 },
  { center: 0.7000, delta:  1.35, halfWidth: 0.042 },
  { center: 0.0400, delta: -1.35, halfWidth: 0.042 },
  { center: 0.5000, delta:  0.65, halfWidth: 0.042 },
  { center: 0.5400, delta:  0.65, halfWidth: 0.042 },
  { center: 0.5800, delta: -0.65, halfWidth: 0.042 },
  { center: 0.6200, delta: -0.65, halfWidth: 0.042 },
  { center: 0.7000, delta:  0.65, halfWidth: 0.042 },
  // Narrow final-complex refinement discovered after local brake optimization.
  { center: 0.9000, delta:  0.80, halfWidth: 0.022 },
] as const;

export function buildMachineOptimalPitwallLine(seed: readonly number[]): number[] {
  let line = [...seed];
  for (const bump of PITWALL_EXECUTABLE_BUMPS) {
    line = applyBump(line, bump.center, bump.halfWidth, bump.delta);
  }
  return line;
}

function applyBump(
  source: readonly number[],
  center: number,
  halfWidth: number,
  delta: number,
): number[] {
  const limit = REFERENCE_LANE_LIMIT - LINE_MARGIN;
  return source.map((lane, index) => {
    const progress = index / source.length;
    const distance = Math.abs(circularDelta(progress, center));
    if (distance >= halfWidth) return lane;
    const phase = distance / halfWidth;
    const weight = 0.5 * (1 + Math.cos(Math.PI * phase));
    return clamp(lane + delta * weight, -limit, limit);
  });
}

function circularDelta(a: number, b: number): number {
  let delta = a - b;
  while (delta > 0.5) delta -= 1;
  while (delta < -0.5) delta += 1;
  return delta;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
