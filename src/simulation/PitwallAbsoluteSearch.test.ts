import { describe, expect, it } from 'vitest';
import { evaluateMachineFlyingLap } from './MachineLapEvaluator';
import { PitwallAbsolutePilot } from './PitwallAbsolutePilot';
import { PITWALL_ABSOLUTE_PROFILE } from './PitwallAbsoluteProfile';
import { createPitwallJointSeed, materializePitwallJointLine } from './PitwallJointOptimizer';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

describe('Pitwall absolute profile search probe', () => {
  it('measures legal central-complex speed headroom without changing physics', () => {
    installReferenceLineCalibration();
    const lanes = materializePitwallJointLine(
      OPTIMIZED_REFERENCE_LANES['pitwall-gp'],
      createPitwallJointSeed(),
    );
    const lifts = [0, 0.5, 1.0, 1.5, 2.0, 2.5] as const;
    const results = lifts.map((lift) => {
      const profile = PITWALL_ABSOLUTE_PROFILE.map((sample, index) => {
        const progress = index / PITWALL_ABSOLUTE_PROFILE.length;
        const weight = windowWeight(progress, 0.485, 0.635, 0.035);
        return { ...sample, speed: sample.speed + lift * weight };
      });
      const pilot = new PitwallAbsolutePilot(lanes, { profile });
      const result = evaluateMachineFlyingLap({
        trackId: 'pitwall-gp',
        policy: (context) => pilot.control(context),
        maximumSeconds: 60,
        tireWear: 0,
        tyreSlideSeed: 0.37,
      });
      return { lift, result };
    });

    console.log('PITWALL_ABSOLUTE_CENTRAL_SPEED_SWEEP', JSON.stringify(results.map(({ lift, result }) => ({
      lift,
      seconds: result.lapSeconds === undefined ? null : Number(result.lapSeconds.toFixed(3)),
      maxLaneDistance: Number(result.maxLaneDistance.toFixed(3)),
      maxLaneProgress: Number(result.maxLaneProgress.toFixed(4)),
      illegalSamples: result.illegalSamples,
      slideEvents: result.slideEvents,
    }))));

    const legal = results
      .filter(({ result }) => result.completed
        && result.lapSeconds !== undefined
        && result.illegalSamples === 0
        && result.maxLaneDistance <= REFERENCE_LANE_LIMIT
        && result.slideEvents === 0)
      .sort((a, b) => a.result.lapSeconds! - b.result.lapSeconds!);

    expect(legal.length).toBeGreaterThan(0);
    expect(legal[0].result.lapSeconds!).toBeLessThanOrEqual(25.85 + 1e-9);
  }, 15_000);
});

function windowWeight(progress: number, start: number, end: number, feather: number): number {
  if (progress >= start && progress <= end) return 1;
  if (progress >= start - feather && progress < start) {
    return smoothstep((progress - (start - feather)) / feather);
  }
  if (progress > end && progress <= end + feather) {
    return 1 - smoothstep((progress - end) / feather);
  }
  return 0;
}

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}
