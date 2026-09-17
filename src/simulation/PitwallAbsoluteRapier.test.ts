import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createPitwallAbsoluteSeed,
  type PitwallAbsoluteGenome,
} from './PitwallAbsoluteOptimizer';
import { evaluatePitwallAbsoluteRapier } from './PitwallAbsoluteRapierEvaluator';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';

describe('Pitwall absolute machine pilot in Rapier', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('replays the current Rapier-verified machine seed in the actual rigid-body world', () => {
    const genome = createPitwallAbsoluteSeed();
    const result = evaluatePitwallAbsoluteRapier(genome);

    console.log('PITWALL_ABSOLUTE_RAPIER', JSON.stringify({
      centralSpeedLift: genome.centralSpeedLift,
      speedDeltas: genome.speedDeltas,
      predictionScale: genome.predictionScale,
      lookAheadScale: genome.lookAheadScale,
      speedFeedback: genome.speedFeedback,
      completed: result.completed,
      seconds: result.lapSeconds === undefined ? null : Number(result.lapSeconds.toFixed(3)),
      maxLaneDistance: Number(result.maxLaneDistance.toFixed(3)),
      maxLaneProgress: Number(result.maxLaneProgress.toFixed(4)),
      maxLaneOffset: Number(result.maxLaneOffset.toFixed(3)),
      illegalSamples: result.illegalSamples,
      peakSlideSeverity: Number(result.peakSlideSeverity.toFixed(3)),
    }));

    expect(result.completed).toBe(true);
    expect(result.illegalSamples).toBe(0);
    expect(result.maxLaneDistance).toBeLessThanOrEqual(REFERENCE_LANE_LIMIT);
    expect(result.peakSlideSeverity).toBe(0);
    expect(result.lapSeconds).toBeDefined();
    expect(result.lapSeconds!).toBeLessThanOrEqual(25.47);
  }, 15_000);

  it('maps the real Rapier stability boundary around the sensitive 54.5% speed window', () => {
    const deltas = [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0] as const;
    const results = deltas.map((delta) => {
      const genome = cloneGenome(createPitwallAbsoluteSeed());
      genome.speedDeltas[1] = delta;
      return { delta, result: evaluatePitwallAbsoluteRapier(genome) };
    });

    console.log('PITWALL_RAPIER_545_SPEED_SWEEP', JSON.stringify(results.map(({ delta, result }) => ({
      delta,
      seconds: result.lapSeconds === undefined ? null : Number(result.lapSeconds.toFixed(3)),
      maxLaneDistance: Number(result.maxLaneDistance.toFixed(3)),
      maxLaneProgress: Number(result.maxLaneProgress.toFixed(4)),
      maxLaneOffset: Number(result.maxLaneOffset.toFixed(3)),
      illegalSamples: result.illegalSamples,
      peakSlideSeverity: Number(result.peakSlideSeverity.toFixed(3)),
    }))));

    const legal = results
      .filter(({ result }) => result.completed
        && result.lapSeconds !== undefined
        && result.illegalSamples === 0
        && result.maxLaneDistance <= REFERENCE_LANE_LIMIT
        && result.peakSlideSeverity === 0)
      .sort((a, b) => a.result.lapSeconds! - b.result.lapSeconds!);

    expect(legal.length).toBeGreaterThan(0);
    expect(legal[0].result.lapSeconds!).toBeLessThanOrEqual(25.47);
  }, 30_000);
});

function cloneGenome(genome: PitwallAbsoluteGenome): PitwallAbsoluteGenome {
  return {
    centralSpeedLift: genome.centralSpeedLift,
    speedDeltas: [...genome.speedDeltas],
    lineDeltas: [...genome.lineDeltas],
    predictionScale: genome.predictionScale,
    lookAheadScale: genome.lookAheadScale,
    speedFeedback: genome.speedFeedback,
  };
}
