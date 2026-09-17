import { describe, expect, it } from 'vitest';
import { evaluateMachineFlyingLap } from './MachineLapEvaluator';
import { PitwallAbsolutePilot } from './PitwallAbsolutePilot';
import { materializePitwallAbsoluteProfile } from './PitwallAbsoluteProfileTuning';
import { createPitwallJointSeed, materializePitwallJointLine } from './PitwallJointOptimizer';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

describe('Pitwall absolute profile search probe', () => {
  it('measures the upper legal central-complex speed margin without changing physics', () => {
    installReferenceLineCalibration();
    const lanes = materializePitwallJointLine(
      OPTIMIZED_REFERENCE_LANES['pitwall-gp'],
      createPitwallJointSeed(),
    );
    const lifts = [2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 6.0] as const;
    const results = lifts.map((centralSpeedLift) => {
      const profile = materializePitwallAbsoluteProfile({ centralSpeedLift });
      const pilot = new PitwallAbsolutePilot(lanes, { profile });
      const result = evaluateMachineFlyingLap({
        trackId: 'pitwall-gp',
        policy: (context) => pilot.control(context),
        maximumSeconds: 60,
        tireWear: 0,
        tyreSlideSeed: 0.37,
      });
      return { centralSpeedLift, result };
    });

    console.log('PITWALL_ABSOLUTE_CENTRAL_SPEED_SWEEP', JSON.stringify(results.map(({ centralSpeedLift, result }) => ({
      centralSpeedLift,
      seconds: result.lapSeconds === undefined ? null : Number(result.lapSeconds.toFixed(3)),
      maxLaneDistance: Number(result.maxLaneDistance.toFixed(3)),
      maxLaneProgress: Number(result.maxLaneProgress.toFixed(4)),
      illegalSamples: result.illegalSamples,
      slideEvents: result.slideEvents,
      maxSlideSeverity: Number(result.maxSlideSeverity.toFixed(3)),
    }))));

    const legal = results
      .filter(({ result }) => result.completed
        && result.lapSeconds !== undefined
        && result.illegalSamples === 0
        && result.maxLaneDistance <= REFERENCE_LANE_LIMIT
        && result.slideEvents === 0)
      .sort((a, b) => a.result.lapSeconds! - b.result.lapSeconds!);

    expect(legal.length).toBeGreaterThan(0);
    expect(legal[0].result.lapSeconds!).toBeLessThanOrEqual(25.683 + 1e-9);
  }, 15_000);
});
