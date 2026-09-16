import { describe, expect, it } from 'vitest';
import { evaluateMachineFlyingLap, type MachineLapResult } from './MachineLapEvaluator';
import { MachineLinePilot } from './MachineLinePilot';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

const CENTERS = [0.50, 0.54, 0.58, 0.62, 0.66, 0.70, 0.84, 0.88, 0.92, 0.96, 0.00, 0.04] as const;
const STEP_METRES = 1.35;
const HALF_WIDTH = 0.042;
const LINE_MARGIN = 0.25;

interface ScoredLine {
  lanes: number[];
  result: MachineLapResult;
  score: number;
}

describe('full-state machine line optimization', () => {
  it('improves the generated Pitwall line using only executable machine laps', () => {
    // Production installs this calibration before any reference lap is used.
    // Optimisation must therefore start from the same physically reachable line,
    // not the older raw analytical bake that the live game never drives.
    installReferenceLineCalibration();
    const seed = [...OPTIMIZED_REFERENCE_LANES['pitwall-gp']];
    let incumbent = scoreLine(seed);
    const baselineSeconds = incumbent.result.lapSeconds;

    console.log('MACHINE_LINE_BASELINE', JSON.stringify({
      completed: incumbent.result.completed,
      seconds: Number((baselineSeconds ?? 0).toFixed(3)),
      maxLaneDistance: Number(incumbent.result.maxLaneDistance.toFixed(2)),
      illegalRatio: Number((incumbent.result.illegalSamples / Math.max(1, incumbent.result.samples)).toFixed(4)),
    }));

    expect(incumbent.result.completed).toBe(true);
    expect(isLegal(incumbent.result)).toBe(true);
    expect(baselineSeconds).toBeDefined();

    const accepted: Array<{ center: number; delta: number; seconds: number }> = [];

    // Broad coordinate descent. Each variable changes tens of adjacent samples,
    // never one baked point, so the search cannot manufacture the sharp lane
    // spikes that made the previous analytical optimum physically unreachable.
    for (const center of CENTERS) {
      let best = incumbent;
      let bestDelta = 0;
      for (const delta of [-STEP_METRES, STEP_METRES]) {
        const candidate = applyBump(incumbent.lanes, center, HALF_WIDTH, delta);
        const scored = scoreLine(candidate);
        if (scored.score + 0.002 < best.score) {
          best = scored;
          bestDelta = delta;
        }
      }
      if (best !== incumbent) {
        incumbent = best;
        accepted.push({
          center,
          delta: bestDelta,
          seconds: incumbent.result.lapSeconds!,
        });
      }
    }

    console.log('MACHINE_LINE_OPTIMIZATION', JSON.stringify({
      baselineSeconds: Number(baselineSeconds!.toFixed(3)),
      optimizedSeconds: Number((incumbent.result.lapSeconds ?? 0).toFixed(3)),
      gainSeconds: Number((baselineSeconds! - (incumbent.result.lapSeconds ?? baselineSeconds!)).toFixed(3)),
      maxLaneDistance: Number(incumbent.result.maxLaneDistance.toFixed(2)),
      illegalRatio: Number((incumbent.result.illegalSamples / Math.max(1, incumbent.result.samples)).toFixed(4)),
      accepted: accepted.map((item) => ({
        center: item.center,
        delta: item.delta,
        seconds: Number(item.seconds.toFixed(3)),
      })),
    }));

    expect(accepted.length).toBeGreaterThan(0);
    expect(isLegal(incumbent.result)).toBe(true);
    expect(incumbent.result.lapSeconds!).toBeLessThan(baselineSeconds! - 0.02);
  }, 60_000);
});

function scoreLine(lanes: readonly number[]): ScoredLine {
  const pilot = new MachineLinePilot('pitwall-gp', lanes);
  const result = evaluateMachineFlyingLap({
    trackId: 'pitwall-gp',
    policy: (context) => pilot.control(context),
    maximumSeconds: 60,
  });
  const legal = isLegal(result);
  const score = result.completed && result.lapSeconds !== undefined && legal
    ? result.lapSeconds
    : 10_000
      + result.illegalSamples * 0.05
      + Math.max(0, result.maxLaneDistance - REFERENCE_LANE_LIMIT) * 25;
  return { lanes: [...lanes], result, score };
}

function isLegal(result: MachineLapResult): boolean {
  return result.completed
    && result.illegalSamples === 0
    && result.maxLaneDistance <= REFERENCE_LANE_LIMIT;
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
