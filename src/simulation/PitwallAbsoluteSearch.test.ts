import { describe, expect, it } from 'vitest';
import { evaluateMachineFlyingLap } from './MachineLapEvaluator';
import { PitwallAbsolutePilot } from './PitwallAbsolutePilot';
import {
  materializePitwallAbsoluteProfile,
  type PitwallAbsoluteSpeedWindow,
} from './PitwallAbsoluteProfileTuning';
import { createPitwallJointSeed, materializePitwallJointLine } from './PitwallJointOptimizer';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

const CENTRAL_SPEED_LIFT = 4.0;
const FINAL_ENTRY_LINE_SHIFT = -0.3;
const PREDICTION_SCALE = 0.10;
const window = (center: number, delta: number): PitwallAbsoluteSpeedWindow => ({
  center,
  halfWidth: 0.018,
  delta,
});

describe('Pitwall absolute profile search probe', () => {
  it('checks whether individually legal final-complex speed windows compose', () => {
    installReferenceLineCalibration();
    const reference = OPTIMIZED_REFERENCE_LANES['pitwall-gp'];
    const seed = createPitwallJointSeed();
    seed.lineDeltas[6] += FINAL_ENTRY_LINE_SHIFT;
    const lanes = materializePitwallJointLine(reference, seed);

    const cases: Array<{ label: string; speedWindows: PitwallAbsoluteSpeedWindow[] }> = [
      { label: 'baseline', speedWindows: [] },
      { label: 'p925', speedWindows: [window(0.925, 1.5)] },
      { label: 'p945', speedWindows: [window(0.945, 1.5)] },
      { label: 'p925+p945', speedWindows: [window(0.925, 1.5), window(0.945, 1.5)] },
      { label: 'p905+p945', speedWindows: [window(0.905, 1.5), window(0.945, 1.5)] },
      { label: 'p905+p925+p945', speedWindows: [
        window(0.905, 1.5),
        window(0.925, 1.5),
        window(0.945, 1.5),
      ] },
      { label: 'p875+p925+p945', speedWindows: [
        window(0.875, 0.5),
        window(0.925, 1.5),
        window(0.945, 1.5),
      ] },
      { label: 'all-legal-singles', speedWindows: [
        window(0.875, 0.5),
        window(0.905, 1.5),
        window(0.925, 1.5),
        window(0.945, 1.5),
      ] },
    ];

    const results = cases.map(({ label, speedWindows }) => {
      const profile = materializePitwallAbsoluteProfile({
        centralSpeedLift: CENTRAL_SPEED_LIFT,
        speedWindows,
      });
      const pilot = new PitwallAbsolutePilot(lanes, {
        profile,
        predictionScale: PREDICTION_SCALE,
        lookAheadScale: 1,
      });
      const result = evaluateMachineFlyingLap({
        trackId: 'pitwall-gp',
        policy: (context) => pilot.control(context),
        maximumSeconds: 60,
        tireWear: 0,
        tyreSlideSeed: 0.37,
      });
      return { label, speedWindows, result };
    });

    console.log('PITWALL_ABSOLUTE_WINDOW_COMBINATIONS', JSON.stringify(results.map(({ label, speedWindows, result }) => ({
      label,
      speedWindows,
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
    expect(legal[0].result.lapSeconds!).toBeLessThanOrEqual(25.558 + 1e-9);
  }, 20_000);
});
