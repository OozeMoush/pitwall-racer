import { describe, expect, it } from 'vitest';
import { evaluateMachineFlyingLap } from './MachineLapEvaluator';
import { MachineLinePilot } from './MachineLinePilot';
import { PITWALL_MACHINE_BRAKE_WINDOWS } from './MachineOptimalControl';
import { buildMachineOptimalPitwallLine } from './MachineOptimalLine';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

describe('machine-only longitudinal optimization', () => {
  it('replays the discovered local brake releases legally', () => {
    installReferenceLineCalibration();
    const lanes = buildMachineOptimalPitwallLine(OPTIMIZED_REFERENCE_LANES['pitwall-gp']);
    const pilot = new MachineLinePilot('pitwall-gp', lanes, {
      brakeWindows: PITWALL_MACHINE_BRAKE_WINDOWS,
    });
    const result = evaluateMachineFlyingLap({
      trackId: 'pitwall-gp',
      policy: (context) => pilot.control(context),
      maximumSeconds: 60,
    });

    console.log('MACHINE_OPTIMAL_CONTROL_REGRESSION', JSON.stringify({
      completed: result.completed,
      seconds: Number((result.lapSeconds ?? 0).toFixed(3)),
      maxLaneDistance: Number(result.maxLaneDistance.toFixed(2)),
      maxLaneProgress: Number(result.maxLaneProgress.toFixed(4)),
      illegalRatio: Number((result.illegalSamples / Math.max(1, result.samples)).toFixed(4)),
    }));

    expect(result.completed).toBe(true);
    expect(result.illegalSamples).toBe(0);
    expect(result.maxLaneDistance).toBeLessThanOrEqual(REFERENCE_LANE_LIMIT);
    expect(result.lapSeconds!).toBeLessThan(25.84);
  }, 10_000);
});
