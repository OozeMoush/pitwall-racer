import { describe, expect, it } from 'vitest';
import { evaluateMachineFlyingLap, type MachineLapResult } from './MachineLapEvaluator';
import {
  MachineLinePilot,
  type MachineSteeringTuning,
} from './MachineLinePilot';
import { PITWALL_MACHINE_BRAKE_WINDOWS } from './MachineOptimalControl';
import { buildMachineOptimalPitwallLine } from './MachineOptimalLine';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

type TuningKey = keyof MachineSteeringTuning;

const SEARCHES: readonly [TuningKey, readonly number[]][] = [
  ['lookAheadScale', [0.82, 0.90, 1.00, 1.10, 1.18]],
  ['headingGainScale', [0.80, 0.90, 1.00, 1.10, 1.20]],
  ['bearingGainScale', [0.70, 0.85, 1.00, 1.15, 1.30]],
  ['lateralGainScale', [0.70, 0.85, 1.00, 1.15, 1.30]],
  ['yawDampingScale', [0.75, 0.90, 1.00, 1.10, 1.25]],
  ['predictionScale', [0.50, 0.75, 1.00, 1.25, 1.50]],
  ['tangentScale', [0.75, 0.90, 1.00, 1.10, 1.25]],
] as const;

interface Candidate {
  tuning: MachineSteeringTuning;
  result: MachineLapResult;
}

describe('machine steering optimization', () => {
  it('coordinate-searches the line follower by executable legal lap time', () => {
    installReferenceLineCalibration();
    const lanes = buildMachineOptimalPitwallLine(OPTIMIZED_REFERENCE_LANES['pitwall-gp']);
    let incumbent = evaluate(lanes, {});
    const baselineSeconds = incumbent.result.lapSeconds!;
    const accepted: Array<{
      parameter: TuningKey;
      value: number;
      seconds: number;
      maxLaneDistance: number;
    }> = [];

    expect(isLegal(incumbent.result)).toBe(true);

    for (const [parameter, values] of SEARCHES) {
      let best = incumbent;
      let bestValue: number | undefined;
      for (const value of values) {
        const tuning = { ...incumbent.tuning, [parameter]: value };
        const candidate = evaluate(lanes, tuning);
        if (!isLegal(candidate.result)) continue;
        if (candidate.result.lapSeconds! + 0.002 < best.result.lapSeconds!) {
          best = candidate;
          bestValue = value;
        }
      }
      if (best !== incumbent) {
        incumbent = best;
        accepted.push({
          parameter,
          value: bestValue!,
          seconds: Number(incumbent.result.lapSeconds!.toFixed(3)),
          maxLaneDistance: Number(incumbent.result.maxLaneDistance.toFixed(2)),
        });
      }
    }

    console.log('MACHINE_STEERING_SEARCH', JSON.stringify({
      baselineSeconds: Number(baselineSeconds.toFixed(3)),
      optimizedSeconds: Number(incumbent.result.lapSeconds!.toFixed(3)),
      gainSeconds: Number((baselineSeconds - incumbent.result.lapSeconds!).toFixed(3)),
      maxLaneDistance: Number(incumbent.result.maxLaneDistance.toFixed(2)),
      maxLaneProgress: Number(incumbent.result.maxLaneProgress.toFixed(4)),
      tuning: incumbent.tuning,
      accepted,
    }));

    expect(isLegal(incumbent.result)).toBe(true);
  }, 55_000);
});

function evaluate(lanes: readonly number[], tuning: MachineSteeringTuning): Candidate {
  const pilot = new MachineLinePilot('pitwall-gp', lanes, {
    brakeWindows: PITWALL_MACHINE_BRAKE_WINDOWS,
    ...tuning,
  });
  const result = evaluateMachineFlyingLap({
    trackId: 'pitwall-gp',
    policy: (context) => pilot.control(context),
    maximumSeconds: 60,
  });
  return { tuning: { ...tuning }, result };
}

function isLegal(result: MachineLapResult): boolean {
  return result.completed
    && result.lapSeconds !== undefined
    && result.illegalSamples === 0
    && result.maxLaneDistance <= REFERENCE_LANE_LIMIT;
}
