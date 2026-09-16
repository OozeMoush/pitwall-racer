import { describe, expect, it } from 'vitest';
import { evaluateMachineFlyingLap } from './MachineLapEvaluator';
import { MachineViabilityDriver } from './MachineViabilityDriver';

describe('machine-only braking viability driver', () => {
  it('finds executable pace without reading the analytical speed table', () => {
    const driver = new MachineViabilityDriver('pitwall-gp');
    const result = evaluateMachineFlyingLap({
      trackId: 'pitwall-gp',
      policy: (context) => driver.control(context),
      maximumSeconds: 70,
    });

    const illegalRatio = result.illegalSamples / Math.max(1, result.samples);
    console.log('MACHINE_VIABILITY_BASELINE', JSON.stringify({
      completed: result.completed,
      lapSeconds: Number((result.lapSeconds ?? 0).toFixed(3)),
      warmupSeconds: Number((result.warmupSeconds ?? 0).toFixed(3)),
      maxLaneDistance: Number(result.maxLaneDistance.toFixed(2)),
      illegalRatio: Number(illegalRatio.toFixed(4)),
      averageKmh: Number((result.averageSpeed * 3.6).toFixed(1)),
      maxKmh: Number((result.maxSpeed * 3.6).toFixed(1)),
    }));

    expect(result.completed).toBe(true);
    expect(illegalRatio).toBe(0);
    // First target: demonstrate that executable control search can beat the
    // current 27.367 s lightweight replay before we optimise the lane itself.
    expect(result.lapSeconds!).toBeLessThan(27.35);
  }, 20_000);
});
