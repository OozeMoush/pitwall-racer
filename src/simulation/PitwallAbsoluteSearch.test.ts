import { describe, expect, it } from 'vitest';
import { evaluateMachineFlyingLap } from './MachineLapEvaluator';
import { PitwallAbsolutePilot } from './PitwallAbsolutePilot';
import { materializePitwallAbsoluteProfile } from './PitwallAbsoluteProfileTuning';
import { createPitwallJointSeed, materializePitwallJointLine } from './PitwallJointOptimizer';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

const CENTRAL_SPEED_LIFT = 4.0;
const FINAL_ENTRY_LINE_SHIFT = -0.3;
const PREDICTION_SCALES = [0, 0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50, 0.60] as const;

describe('Pitwall absolute profile search probe', () => {
  it('retunes predictive steering for the faster absolute longitudinal profile', () => {
    installReferenceLineCalibration();
    const reference = OPTIMIZED_REFERENCE_LANES['pitwall-gp'];
    const seed = createPitwallJointSeed();
    seed.lineDeltas[6] += FINAL_ENTRY_LINE_SHIFT;
    const lanes = materializePitwallJointLine(reference, seed);
    const profile = materializePitwallAbsoluteProfile({ centralSpeedLift: CENTRAL_SPEED_LIFT });

    const results = PREDICTION_SCALES.map((predictionScale) => {
      const pilot = new PitwallAbsolutePilot(lanes, {
        profile,
        predictionScale,
        lookAheadScale: 1,
      });
      const result = evaluateMachineFlyingLap({
        trackId: 'pitwall-gp',
        policy: (context) => pilot.control(context),
        maximumSeconds: 60,
        tireWear: 0,
        tyreSlideSeed: 0.37,
      });
      return { predictionScale, result };
    });

    console.log('PITWALL_ABSOLUTE_PREDICTION_SWEEP', JSON.stringify(results.map(({ predictionScale, result }) => ({
      predictionScale,
      seconds: result.lapSeconds === undefined ? null : Number(result.lapSeconds.toFixed(3)),
      maxLaneDistance: Number(result.maxLaneDistance.toFixed(3)),
      maxLaneProgress: Number(result.maxLaneProgress.toFixed(4)),
      maxLaneOffset: Number(result.maxLaneOffset.toFixed(3)),
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
  }, 20_000);
});
