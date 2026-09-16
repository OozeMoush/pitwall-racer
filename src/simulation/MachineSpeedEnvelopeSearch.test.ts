import { describe, expect, it } from 'vitest';
import { evaluateMachineFlyingLap } from './MachineLapEvaluator';
import { MachineReferencePilot } from './MachineReferencePilot';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';

const SCALES = [1.00, 1.05, 1.10, 1.15, 1.20, 1.25, 1.30] as const;

describe('machine-only executable speed-envelope search', () => {
  it('measures how much pace the current generated line can physically carry', () => {
    const results = SCALES.map((scale) => {
      const pilot = new MachineReferencePilot('pitwall-gp', scale);
      const lap = evaluateMachineFlyingLap({
        trackId: 'pitwall-gp',
        policy: (context) => pilot.control(context),
        maximumSeconds: 65,
      });
      const illegalRatio = lap.illegalSamples / Math.max(1, lap.samples);
      return {
        scale,
        completed: lap.completed,
        seconds: lap.lapSeconds,
        maxLaneDistance: lap.maxLaneDistance,
        illegalRatio,
        averageKmh: lap.averageSpeed * 3.6,
        maxKmh: lap.maxSpeed * 3.6,
      };
    });

    console.log('MACHINE_SPEED_ENVELOPE_SEARCH', JSON.stringify(results.map((result) => ({
      scale: result.scale,
      completed: result.completed,
      seconds: Number((result.seconds ?? 0).toFixed(3)),
      maxLaneDistance: Number(result.maxLaneDistance.toFixed(2)),
      illegalRatio: Number(result.illegalRatio.toFixed(4)),
      averageKmh: Number(result.averageKmh.toFixed(1)),
      maxKmh: Number(result.maxKmh.toFixed(1)),
    }))));

    const legal = results.filter((result) => result.completed
      && result.maxLaneDistance <= REFERENCE_LANE_LIMIT
      && result.illegalRatio === 0
      && result.seconds !== undefined);
    const best = legal.reduce<typeof legal[number] | undefined>(
      (winner, candidate) => !winner || candidate.seconds! < winner.seconds! ? candidate : winner,
      undefined,
    );

    expect(best).toBeDefined();
    expect(best!.seconds!).toBeLessThan(27.367);
  }, 20_000);
});
