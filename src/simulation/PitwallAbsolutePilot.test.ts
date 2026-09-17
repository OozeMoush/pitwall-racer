import { describe, expect, it } from 'vitest';
import { evaluateMachineFlyingLap } from './MachineLapEvaluator';
import { PitwallAbsolutePilot } from './PitwallAbsolutePilot';
import { createPitwallJointSeed, materializePitwallJointLine } from './PitwallJointOptimizer';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

describe('Pitwall absolute longitudinal pilot', () => {
  it('replays the machine-only 64-node trace as a legal full-state lap', () => {
    installReferenceLineCalibration();
    const lanes = materializePitwallJointLine(
      OPTIMIZED_REFERENCE_LANES['pitwall-gp'],
      createPitwallJointSeed(),
    );
    const pilot = new PitwallAbsolutePilot(lanes);
    const result = evaluateMachineFlyingLap({
      trackId: 'pitwall-gp',
      policy: (context) => pilot.control(context),
      maximumSeconds: 60,
      tireWear: 0,
      tyreSlideSeed: 0.37,
    });

    console.log('PITWALL_ABSOLUTE_PILOT', JSON.stringify({
      completed: result.completed,
      seconds: result.lapSeconds === undefined ? null : Number(result.lapSeconds.toFixed(3)),
      maxLaneDistance: Number(result.maxLaneDistance.toFixed(3)),
      maxLaneProgress: Number(result.maxLaneProgress.toFixed(4)),
      maxLaneOffset: Number(result.maxLaneOffset.toFixed(3)),
      illegalSamples: result.illegalSamples,
      slideEvents: result.slideEvents,
      maxSlideSeverity: Number(result.maxSlideSeverity.toFixed(3)),
    }));

    expect(result.completed).toBe(true);
    expect(result.lapSeconds).toBeDefined();
    expect(result.illegalSamples).toBe(0);
    expect(result.maxLaneDistance).toBeLessThanOrEqual(REFERENCE_LANE_LIMIT);
    expect(result.slideEvents).toBe(0);
  }, 15_000);
});
