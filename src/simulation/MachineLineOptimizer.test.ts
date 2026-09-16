import { describe, expect, it } from 'vitest';
import { evaluateMachineFlyingLap, type MachineLapResult } from './MachineLapEvaluator';
import { MachineLinePilot } from './MachineLinePilot';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

const BASE_CENTERS = [0.50, 0.54, 0.58, 0.62, 0.66, 0.70, 0.84, 0.88, 0.92, 0.96, 0.00, 0.04] as const;
const LINE_MARGIN = 0.25;

interface ScoredLine {
  lanes: number[];
  result: MachineLapResult;
  score: number;
}

describe('full-state machine line optimization', () => {
  it('repairs the fast line into a legal executable lap before optimizing time', () => {
    installReferenceLineCalibration();
    const seed = [...OPTIMIZED_REFERENCE_LANES['pitwall-gp']];
    let incumbent = scoreLine(seed);
    const baselineSeconds = incumbent.result.lapSeconds;

    console.log('MACHINE_LINE_BASELINE', JSON.stringify(summary(incumbent.result)));

    expect(incumbent.result.completed).toBe(true);
    expect(baselineSeconds).toBeDefined();

    const accepted: Array<{
      phase: string;
      center: number;
      delta: number;
      halfWidth: number;
      seconds: number;
      maxLaneDistance: number;
      maxLaneProgress: number;
      illegalRatio: number;
    }> = [];

    // Phase 1: repair the concentrated off-track excursion. Search both the
    // measured worst point and several points *before* it because a 300 km/h
    // car must alter its trajectory before the visible error peaks.
    for (const step of [3.0, 1.8, 1.0]) {
      const worst = incumbent.result.maxLaneProgress;
      const centers = uniqueCircular([
        worst - 0.080,
        worst - 0.060,
        worst - 0.040,
        worst - 0.020,
        worst,
        worst + 0.020,
      ]);
      incumbent = sweep(incumbent, centers, step, 0.055, `repair-${step}`, accepted);
    }

    // Phase 2: once the worst excursion has been pulled back, give the two
    // technical complexes broad, smooth coordinate-descent adjustments. These
    // are trajectory deformations, not individual point edits.
    for (const step of [1.35, 0.65]) {
      incumbent = sweep(incumbent, BASE_CENTERS, step, 0.042, `pace-${step}`, accepted);
    }

    console.log('MACHINE_LINE_OPTIMIZATION', JSON.stringify({
      baseline: summaryFromSeconds(baselineSeconds!, scoreLine(seed).result),
      optimized: summary(incumbent.result),
      score: Number(incumbent.score.toFixed(3)),
      accepted,
    }));

    expect(accepted.length).toBeGreaterThan(0);
    expect(isLegal(incumbent.result)).toBe(true);
    expect(incumbent.result.lapSeconds).toBeDefined();
  }, 60_000);
});

function sweep(
  start: ScoredLine,
  centers: readonly number[],
  stepMetres: number,
  halfWidth: number,
  phase: string,
  accepted: Array<{
    phase: string;
    center: number;
    delta: number;
    halfWidth: number;
    seconds: number;
    maxLaneDistance: number;
    maxLaneProgress: number;
    illegalRatio: number;
  }>,
): ScoredLine {
  let incumbent = start;
  for (const center of centers) {
    let best = incumbent;
    let bestDelta = 0;
    for (const delta of [-stepMetres, stepMetres]) {
      const candidate = applyBump(incumbent.lanes, center, halfWidth, delta);
      const scored = scoreLine(candidate);
      if (scored.score + 0.002 < best.score) {
        best = scored;
        bestDelta = delta;
      }
    }
    if (best !== incumbent) {
      incumbent = best;
      const result = incumbent.result;
      accepted.push({
        phase,
        center: Number(wrap01(center).toFixed(4)),
        delta: bestDelta,
        halfWidth,
        seconds: Number((result.lapSeconds ?? 0).toFixed(3)),
        maxLaneDistance: Number(result.maxLaneDistance.toFixed(2)),
        maxLaneProgress: Number(result.maxLaneProgress.toFixed(4)),
        illegalRatio: Number((result.illegalSamples / Math.max(1, result.samples)).toFixed(4)),
      });
    }
  }
  return incumbent;
}

function scoreLine(lanes: readonly number[]): ScoredLine {
  const pilot = new MachineLinePilot('pitwall-gp', lanes);
  const result = evaluateMachineFlyingLap({
    trackId: 'pitwall-gp',
    policy: (context) => pilot.control(context),
    maximumSeconds: 60,
  });
  const illegalRatio = result.illegalSamples / Math.max(1, result.samples);
  const outside = Math.max(0, result.maxLaneDistance - REFERENCE_LANE_LIMIT);

  // Continuous constraint penalty gives the search a gradient from the fast but
  // illegal seed toward the legal envelope. Once legal, score is pure lap time.
  const score = result.completed && result.lapSeconds !== undefined
    ? result.lapSeconds + illegalRatio * 650 + outside * 7.5
    : 1_000 + illegalRatio * 650 + outside * 7.5;
  return { lanes: [...lanes], result, score };
}

function isLegal(result: MachineLapResult): boolean {
  return result.completed
    && result.illegalSamples === 0
    && result.maxLaneDistance <= REFERENCE_LANE_LIMIT;
}

function summary(result: MachineLapResult) {
  return {
    completed: result.completed,
    seconds: Number((result.lapSeconds ?? 0).toFixed(3)),
    maxLaneDistance: Number(result.maxLaneDistance.toFixed(2)),
    maxLaneProgress: Number(result.maxLaneProgress.toFixed(4)),
    maxLaneOffset: Number(result.maxLaneOffset.toFixed(2)),
    illegalRatio: Number((result.illegalSamples / Math.max(1, result.samples)).toFixed(4)),
    averageKmh: Number((result.averageSpeed * 3.6).toFixed(1)),
    maxKmh: Number((result.maxSpeed * 3.6).toFixed(1)),
  };
}

function summaryFromSeconds(seconds: number, result: MachineLapResult) {
  return { ...summary(result), seconds: Number(seconds.toFixed(3)) };
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

function uniqueCircular(values: readonly number[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const value of values) {
    const wrapped = wrap01(value);
    const key = Math.round(wrapped * 10_000);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(wrapped);
  }
  return result;
}

function circularDelta(a: number, b: number): number {
  let delta = a - b;
  while (delta > 0.5) delta -= 1;
  while (delta < -0.5) delta += 1;
  return delta;
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
