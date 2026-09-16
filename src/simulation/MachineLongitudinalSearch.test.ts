import { describe, expect, it } from 'vitest';
import { evaluateMachineFlyingLap } from './MachineLapEvaluator';
import { MachineLinePilot } from './MachineLinePilot';
import { buildMachineOptimalPitwallLine } from './MachineOptimalLine';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

const SCALES = [1.00, 0.90, 0.80, 0.70] as const;

describe('machine-only longitudinal search', () => {
  it('searches brake carry on the legal machine trajectory', () => {
    installReferenceLineCalibration();
    const lanes = buildMachineOptimalPitwallLine(OPTIMIZED_REFERENCE_LANES['pitwall-gp']);
    const results: Array<{
      middle: number;
      final: number;
      completed: boolean;
      seconds?: number;
      maxLaneDistance: number;
      illegalRatio: number;
      averageKmh: number;
    }> = [];

    for (const middle of SCALES) {
      for (const final of SCALES) {
        const pilot = new MachineLinePilot('pitwall-gp', lanes, {
          middleBrakeScale: middle,
          finalBrakeScale: final,
        });
        const result = evaluateMachineFlyingLap({
          trackId: 'pitwall-gp',
          policy: (context) => pilot.control(context),
          maximumSeconds: 60,
        });
        results.push({
          middle,
          final,
          completed: result.completed,
          seconds: result.lapSeconds,
          maxLaneDistance: result.maxLaneDistance,
          illegalRatio: result.illegalSamples / Math.max(1, result.samples),
          averageKmh: result.averageSpeed * 3.6,
        });
      }
    }

    const legal = results.filter((result) => result.completed
      && result.seconds !== undefined
      && result.illegalRatio === 0
      && result.maxLaneDistance <= REFERENCE_LANE_LIMIT);
    const best = legal.reduce<typeof legal[number] | undefined>(
      (winner, candidate) => !winner || candidate.seconds! < winner.seconds! ? candidate : winner,
      undefined,
    );

    console.log('MACHINE_LONGITUDINAL_SEARCH', JSON.stringify({
      best: best ? compact(best) : null,
      results: results.map(compact),
    }));

    expect(best).toBeDefined();
    expect(best!.seconds!).toBeLessThan(25.833);
  }, 30_000);
});

function compact(result: {
  middle: number;
  final: number;
  completed: boolean;
  seconds?: number;
  maxLaneDistance: number;
  illegalRatio: number;
  averageKmh: number;
}) {
  return {
    middle: result.middle,
    final: result.final,
    completed: result.completed,
    seconds: Number((result.seconds ?? 0).toFixed(3)),
    maxLaneDistance: Number(result.maxLaneDistance.toFixed(2)),
    illegalRatio: Number(result.illegalRatio.toFixed(4)),
    averageKmh: Number(result.averageKmh.toFixed(1)),
  };
}
