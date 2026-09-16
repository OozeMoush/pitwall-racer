import { describe, expect, it } from 'vitest';
import { evaluateMachineFlyingLap, type MachineLapResult } from './MachineLapEvaluator';
import { MachineLinePilot } from './MachineLinePilot';
import { PITWALL_MACHINE_BRAKE_WINDOWS } from './MachineOptimalControl';
import { buildMachineOptimalPitwallLine } from './MachineOptimalLine';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

const CENTERS = [0.82, 0.84, 0.86, 0.88, 0.90, 0.92, 0.94, 0.96, 0.98, 0.00, 0.02, 0.04, 0.06] as const;
const DELTAS = [-0.80, 0.80, -0.40, 0.40] as const;
const HALF_WIDTH = 0.022;

interface Candidate {
  lanes: number[];
  result: MachineLapResult;
}

describe('machine trajectory refinement search', () => {
  it('coordinate-searches the final complex with executable full laps', () => {
    installReferenceLineCalibration();
    const seed = buildMachineOptimalPitwallLine(OPTIMIZED_REFERENCE_LANES['pitwall-gp']);
    let incumbent = evaluate(seed);
    const baselineSeconds = incumbent.result.lapSeconds!;
    const accepted: Array<{
      center: number;
      delta: number;
      seconds: number;
      maxLaneDistance: number;
    }> = [];

    expect(isLegal(incumbent.result)).toBe(true);

    for (const center of CENTERS) {
      let best = incumbent;
      let bestDelta = 0;
      for (const delta of DELTAS) {
        const lanes = applyBump(incumbent.lanes, center, HALF_WIDTH, delta);
        const candidate = evaluate(lanes);
        if (!isLegal(candidate.result)) continue;
        if (candidate.result.lapSeconds! + 0.002 < best.result.lapSeconds!) {
          best = candidate;
          bestDelta = delta;
        }
      }
      if (best !== incumbent) {
        incumbent = best;
        accepted.push({
          center,
          delta: bestDelta,
          seconds: Number(incumbent.result.lapSeconds!.toFixed(3)),
          maxLaneDistance: Number(incumbent.result.maxLaneDistance.toFixed(2)),
        });
      }
    }

    console.log('MACHINE_FINAL_LINE_REFINEMENT', JSON.stringify({
      baselineSeconds: Number(baselineSeconds.toFixed(3)),
      optimizedSeconds: Number(incumbent.result.lapSeconds!.toFixed(3)),
      gainSeconds: Number((baselineSeconds - incumbent.result.lapSeconds!).toFixed(3)),
      maxLaneDistance: Number(incumbent.result.maxLaneDistance.toFixed(2)),
      maxLaneProgress: Number(incumbent.result.maxLaneProgress.toFixed(4)),
      accepted,
    }));

    expect(accepted.length).toBeGreaterThan(0);
    expect(isLegal(incumbent.result)).toBe(true);
  }, 55_000);
});

function evaluate(lanes: readonly number[]): Candidate {
  const pilot = new MachineLinePilot('pitwall-gp', lanes, {
    brakeWindows: PITWALL_MACHINE_BRAKE_WINDOWS,
  });
  const result = evaluateMachineFlyingLap({
    trackId: 'pitwall-gp',
    policy: (context) => pilot.control(context),
    maximumSeconds: 60,
  });
  return { lanes: [...lanes], result };
}

function isLegal(result: MachineLapResult): boolean {
  return result.completed
    && result.lapSeconds !== undefined
    && result.illegalSamples === 0
    && result.maxLaneDistance <= REFERENCE_LANE_LIMIT;
}

function applyBump(source: readonly number[], center: number, halfWidth: number, delta: number): number[] {
  const limit = REFERENCE_LANE_LIMIT - 0.25;
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
