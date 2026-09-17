import { describe, expect, it } from 'vitest';
import { evaluateMachineFlyingLap } from './MachineLapEvaluator';
import { PitwallAbsolutePilot } from './PitwallAbsolutePilot';
import { materializePitwallAbsoluteProfile } from './PitwallAbsoluteProfileTuning';
import {
  createPitwallJointSeed,
  materializePitwallJointLine,
  type PitwallJointGenome,
} from './PitwallJointOptimizer';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

const CENTRAL_SPEED_LIFT = 4.0;
const FINAL_LINE_INDICES = [6, 7, 8, 9, 10] as const;
const SHIFTS = [-0.6, -0.3, 0.3, 0.6] as const;

describe('Pitwall absolute profile search probe', () => {
  it('finds final-complex line geometry headroom before adding more speed', () => {
    installReferenceLineCalibration();
    const reference = OPTIMIZED_REFERENCE_LANES['pitwall-gp'];
    const seed = createPitwallJointSeed();
    const profile = materializePitwallAbsoluteProfile({ centralSpeedLift: CENTRAL_SPEED_LIFT });

    const cases: Array<{ label: string; genome: PitwallJointGenome }> = [
      { label: 'baseline', genome: cloneGenome(seed) },
    ];
    for (const index of FINAL_LINE_INDICES) {
      for (const shift of SHIFTS) {
        const genome = cloneGenome(seed);
        genome.lineDeltas[index] += shift;
        cases.push({ label: `line[${index}]${shift >= 0 ? '+' : ''}${shift}`, genome });
      }
    }

    const results = cases.map(({ label, genome }) => {
      const lanes = materializePitwallJointLine(reference, genome);
      const pilot = new PitwallAbsolutePilot(lanes, { profile });
      const result = evaluateMachineFlyingLap({
        trackId: 'pitwall-gp',
        policy: (context) => pilot.control(context),
        maximumSeconds: 60,
        tireWear: 0,
        tyreSlideSeed: 0.37,
      });
      return { label, genome, result };
    });

    console.log('PITWALL_ABSOLUTE_FINAL_LINE_SWEEP', JSON.stringify(results.map(({ label, result }) => ({
      label,
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

function cloneGenome(genome: PitwallJointGenome): PitwallJointGenome {
  return {
    lineDeltas: [...genome.lineDeltas],
    speedScales: [...genome.speedScales],
    brakeScales: [...genome.brakeScales],
    predictionScale: genome.predictionScale,
    lookAheadScale: genome.lookAheadScale,
  };
}
