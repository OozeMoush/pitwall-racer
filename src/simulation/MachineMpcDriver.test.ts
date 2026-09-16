import { describe, expect, it } from 'vitest';
import { evaluateMachineFlyingLap } from './MachineLapEvaluator';
import { MachineMpcDriver } from './MachineMpcDriver';

describe('machine-only predictive driver', () => {
  it('searches controls by executable progress rather than the reference speed table', () => {
    const driver = new MachineMpcDriver('pitwall-gp');
    const result = evaluateMachineFlyingLap({
      trackId: 'pitwall-gp',
      policy: (context) => driver.control(context),
      maximumSeconds: 75,
    });

    const illegalRatio = result.illegalSamples / Math.max(1, result.samples);
    console.log('MACHINE_MPC_BASELINE', JSON.stringify({
      completed: result.completed,
      lapSeconds: Number((result.lapSeconds ?? 0).toFixed(3)),
      warmupSeconds: Number((result.warmupSeconds ?? 0).toFixed(3)),
      maxLaneDistance: Number(result.maxLaneDistance.toFixed(2)),
      illegalRatio: Number(illegalRatio.toFixed(4)),
      averageKmh: Number((result.averageSpeed * 3.6).toFixed(1)),
      maxKmh: Number((result.maxSpeed * 3.6).toFixed(1)),
    }));

    expect(result.completed).toBe(true);
    expect(illegalRatio).toBeLessThan(0.02);
    // This first MPC regression is diagnostic. #61 will tighten the gate to the
    // machine-optimal target after trajectory/control search converges.
    expect(result.lapSeconds!).toBeLessThan(35);
  }, 30_000);
});
