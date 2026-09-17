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
const PREDICTION_SCALE = 0.10;
const CENTERS = [0.875, 0.905, 0.925, 0.945] as const;
const DELTAS = [0.5, 1.0, 1.5] as const;

describe('Pitwall absolute profile search probe', () => {
  it('isolates final-complex speed headroom with local absolute-speed windows', () => {
    installReferenceLineCalibration();
    const reference = OPTIMIZED_REFERENCE_LANES['pitwall-gp'];
    const seed = createPitwallJointSeed();
    seed.lineDeltas[6] += FINAL_ENTRY_LINE_SHIFT;
    const lanes = materializePitwallJointLine(reference, seed);

    const cases: Array<{ label: string; center?: number; delta?: number }> = [
      { label: 'baseline' },
      ...CENTERS.flatMap((center) => DELTAS.map((delta) => ({
        label: `p${center}+${delta}`,
        center,
        delta,
      }))),
    ];

    const results = cases.map(({ label, center, delta }) => {
      const profile = materializePitwallAbsoluteProfile({
        centralSpeedLift: CENTRAL_SPEED_LIFT,
        speedWindows: center === undefined || delta === undefined
          ? []
          : [{ center, halfWidth: 0.018, delta }],
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
      return { label, center, delta, result };
    });

    console.log('PITWALL_ABSOLUTE_LOCAL_SPEED_SWEEP', JSON.stringify(results.map(({ label, center, delta, result }) => ({
      label,
      center: center ?? null,
      delta: delta ?? 0,
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
  }, 30_000);
});
