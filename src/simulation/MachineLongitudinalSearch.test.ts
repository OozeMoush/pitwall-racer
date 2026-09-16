import { describe, expect, it } from 'vitest';
import { evaluateMachineFlyingLap, type MachineLapResult } from './MachineLapEvaluator';
import { MachineLinePilot, type MachineBrakeWindow } from './MachineLinePilot';
import { buildMachineOptimalPitwallLine } from './MachineOptimalLine';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

const CENTERS = [
  0.46, 0.48, 0.50, 0.52, 0.54, 0.56, 0.58, 0.60, 0.62, 0.64, 0.66, 0.68, 0.70, 0.72, 0.74,
  0.80, 0.82, 0.84, 0.86, 0.88, 0.90, 0.92, 0.94, 0.96, 0.98, 0.00, 0.02, 0.04, 0.06, 0.08,
] as const;
const SCALES = [0.90, 0.80, 0.70] as const;
const HALF_WIDTH = 0.010;

interface Candidate {
  windows: MachineBrakeWindow[];
  result: MachineLapResult;
}

describe('machine-only longitudinal search', () => {
  it('removes only locally unnecessary braking on the legal machine trajectory', () => {
    installReferenceLineCalibration();
    const lanes = buildMachineOptimalPitwallLine(OPTIMIZED_REFERENCE_LANES['pitwall-gp']);
    let incumbent = evaluate(lanes, []);
    const baselineSeconds = incumbent.result.lapSeconds!;
    const accepted: Array<{
      center: number;
      scale: number;
      seconds: number;
      maxLaneDistance: number;
    }> = [];

    expect(isLegal(incumbent.result)).toBe(true);

    for (const center of CENTERS) {
      let best = incumbent;
      let acceptedScale: number | undefined;
      for (const scale of SCALES) {
        const windows = [...incumbent.windows, { center, halfWidth: HALF_WIDTH, scale }];
        const candidate = evaluate(lanes, windows);
        if (!isLegal(candidate.result) || candidate.result.lapSeconds === undefined) continue;
        if (candidate.result.lapSeconds + 0.002 < best.result.lapSeconds!) {
          best = candidate;
          acceptedScale = scale;
        }
      }
      if (best !== incumbent) {
        incumbent = best;
        accepted.push({
          center,
          scale: acceptedScale!,
          seconds: Number(incumbent.result.lapSeconds!.toFixed(3)),
          maxLaneDistance: Number(incumbent.result.maxLaneDistance.toFixed(2)),
        });
      }
    }

    console.log('MACHINE_LOCAL_BRAKE_SEARCH', JSON.stringify({
      baselineSeconds: Number(baselineSeconds.toFixed(3)),
      optimizedSeconds: Number(incumbent.result.lapSeconds!.toFixed(3)),
      gainSeconds: Number((baselineSeconds - incumbent.result.lapSeconds!).toFixed(3)),
      maxLaneDistance: Number(incumbent.result.maxLaneDistance.toFixed(2)),
      illegalRatio: Number((incumbent.result.illegalSamples / Math.max(1, incumbent.result.samples)).toFixed(4)),
      averageKmh: Number((incumbent.result.averageSpeed * 3.6).toFixed(1)),
      accepted,
    }));

    expect(accepted.length).toBeGreaterThan(0);
    expect(isLegal(incumbent.result)).toBe(true);
    expect(incumbent.result.lapSeconds!).toBeLessThan(baselineSeconds - 0.01);
  }, 120_000);
});

function evaluate(lanes: readonly number[], windows: readonly MachineBrakeWindow[]): Candidate {
  const pilot = new MachineLinePilot('pitwall-gp', lanes, { brakeWindows: windows });
  const result = evaluateMachineFlyingLap({
    trackId: 'pitwall-gp',
    policy: (context) => pilot.control(context),
    maximumSeconds: 60,
  });
  return { windows: [...windows], result };
}

function isLegal(result: MachineLapResult): boolean {
  return result.completed
    && result.lapSeconds !== undefined
    && result.illegalSamples === 0
    && result.maxLaneDistance <= REFERENCE_LANE_LIMIT;
}
