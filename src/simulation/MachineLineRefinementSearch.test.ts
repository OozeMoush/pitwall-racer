import { describe, expect, it } from 'vitest';
import { evaluateMachineFlyingLap, type MachineLapResult } from './MachineLapEvaluator';
import { MachineLinePilot } from './MachineLinePilot';
import { PITWALL_MACHINE_BRAKE_WINDOWS } from './MachineOptimalControl';
import { buildMachineOptimalPitwallLine } from './MachineOptimalLine';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

const PREDICTION_SCALES = [0, 0.20, 0.35, 0.45, 0.50, 0.55, 0.65] as const;

describe('machine steering optimization', () => {
  it('refines the predictive steering contribution by executable legal lap time', () => {
    installReferenceLineCalibration();
    const lanes = buildMachineOptimalPitwallLine(OPTIMIZED_REFERENCE_LANES['pitwall-gp']);
    const results = PREDICTION_SCALES.map((predictionScale) => {
      const pilot = new MachineLinePilot('pitwall-gp', lanes, {
        brakeWindows: PITWALL_MACHINE_BRAKE_WINDOWS,
        predictionScale,
      });
      const result = evaluateMachineFlyingLap({
        trackId: 'pitwall-gp',
        policy: (context) => pilot.control(context),
        maximumSeconds: 60,
      });
      return { predictionScale, result };
    });

    const legal = results.filter(({ result }) => isLegal(result));
    const best = legal.reduce<typeof legal[number] | undefined>(
      (winner, candidate) => !winner || candidate.result.lapSeconds! < winner.result.lapSeconds!
        ? candidate
        : winner,
      undefined,
    );

    console.log('MACHINE_PREDICTION_SCALE_SEARCH', JSON.stringify({
      best: best ? compact(best.predictionScale, best.result) : null,
      results: results.map(({ predictionScale, result }) => compact(predictionScale, result)),
    }));

    expect(best).toBeDefined();
    expect(best!.result.lapSeconds!).toBeLessThan(25.80);
  }, 15_000);
});

function compact(predictionScale: number, result: MachineLapResult) {
  return {
    predictionScale,
    completed: result.completed,
    seconds: Number((result.lapSeconds ?? 0).toFixed(3)),
    maxLaneDistance: Number(result.maxLaneDistance.toFixed(2)),
    illegalRatio: Number((result.illegalSamples / Math.max(1, result.samples)).toFixed(4)),
  };
}

function isLegal(result: MachineLapResult): boolean {
  return result.completed
    && result.lapSeconds !== undefined
    && result.illegalSamples === 0
    && result.maxLaneDistance <= REFERENCE_LANE_LIMIT;
}
