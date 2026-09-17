import { describe, expect, it } from 'vitest';
import { evaluateMachineFlyingLap } from './MachineLapEvaluator';
import { PitwallAbsolutePilot } from './PitwallAbsolutePilot';
import { materializePitwallAbsoluteProfile } from './PitwallAbsoluteProfileTuning';
import { createPitwallJointSeed, materializePitwallJointLine } from './PitwallJointOptimizer';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

const CENTRAL_SPEED_LIFT = 4.0;

describe('Pitwall absolute profile search probe', () => {
  it('measures final-complex speed headroom on the legal central-lift baseline', () => {
    installReferenceLineCalibration();
    const lanes = materializePitwallJointLine(
      OPTIMIZED_REFERENCE_LANES['pitwall-gp'],
      createPitwallJointSeed(),
    );
    const lifts = [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0] as const;
    const results = lifts.map((finalSpeedLift) => {
      const profile = materializePitwallAbsoluteProfile({
        centralSpeedLift: CENTRAL_SPEED_LIFT,
        finalSpeedLift,
      });
      const pilot = new PitwallAbsolutePilot(lanes, { profile });
      const result = evaluateMachineFlyingLap({
        trackId: 'pitwall-gp',
        policy: (context) => pilot.control(context),
        maximumSeconds: 60,
        tireWear: 0,
        tyreSlideSeed: 0.37,
      });
      return { finalSpeedLift, result };
    });

    console.log('PITWALL_ABSOLUTE_FINAL_SPEED_SWEEP', JSON.stringify(results.map(({ finalSpeedLift, result }) => ({
      centralSpeedLift: CENTRAL_SPEED_LIFT,
      finalSpeedLift,
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
    expect(legal[0].result.lapSeconds!).toBeLessThanOrEqual(25.60 + 1e-9);
  }, 15_000);
});
