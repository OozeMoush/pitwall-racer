import { describe, expect, it } from 'vitest';
import { evaluateMachineFlyingLap } from './MachineLapEvaluator';
import { MachineLinePilot } from './MachineLinePilot';
import { buildMachineOptimalPitwallLine } from './MachineOptimalLine';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

describe('full-state machine line optimization', () => {
  it('replays the machine-discovered Pitwall line as a legal executable lap', () => {
    installReferenceLineCalibration();
    const lanes = buildMachineOptimalPitwallLine(OPTIMIZED_REFERENCE_LANES['pitwall-gp']);
    const pilot = new MachineLinePilot('pitwall-gp', lanes);
    const result = evaluateMachineFlyingLap({
      trackId: 'pitwall-gp',
      policy: (context) => pilot.control(context),
      maximumSeconds: 60,
    });
    const illegalRatio = result.illegalSamples / Math.max(1, result.samples);

    console.log('MACHINE_OPTIMAL_LINE_REGRESSION', JSON.stringify({
      completed: result.completed,
      seconds: Number((result.lapSeconds ?? 0).toFixed(3)),
      maxLaneDistance: Number(result.maxLaneDistance.toFixed(2)),
      maxLaneProgress: Number(result.maxLaneProgress.toFixed(4)),
      maxLaneOffset: Number(result.maxLaneOffset.toFixed(2)),
      illegalRatio: Number(illegalRatio.toFixed(4)),
      averageKmh: Number((result.averageSpeed * 3.6).toFixed(1)),
      maxKmh: Number((result.maxSpeed * 3.6).toFixed(1)),
    }));

    expect(result.completed).toBe(true);
    expect(result.illegalSamples).toBe(0);
    expect(result.maxLaneDistance).toBeLessThanOrEqual(REFERENCE_LANE_LIMIT);
    expect(result.lapSeconds).toBeDefined();
    expect(result.lapSeconds!).toBeLessThan(26.0);
  }, 10_000);
});
