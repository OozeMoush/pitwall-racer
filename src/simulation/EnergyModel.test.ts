import { describe, expect, it } from 'vitest';
import { createEnergy, stepEnergy } from './EnergyModel';

describe('EnergyModel', () => {
  it('charges while the throttle is held in HARVEST mode and sacrifices obvious pace', () => {
    const initial = createEnergy(0.35, 'HARVEST');
    const next = stepEnergy(initial, { throttle: 1, brake: 0, speed: 75, mode: 'HARVEST' }, 2);

    expect(next.soc).toBeGreaterThan(initial.soc);
    expect(next.harvesting).toBeGreaterThan(0);
    expect(next.powerBoost).toBeLessThanOrEqual(-0.4);
  });

  it('keeps NORMAL sustainable instead of emptying the battery under held throttle', () => {
    let energy = createEnergy(0.7, 'NORMAL');
    for (let second = 0; second < 60; second++) {
      energy = stepEnergy(energy, { throttle: 1, brake: 0, speed: 90, mode: 'NORMAL' }, 1);
    }

    expect(energy.soc).toBeGreaterThan(0.35);
    expect(energy.powerBoost).toBeGreaterThan(0);
  });

  it('makes DEPLOY substantially faster and more expensive than NORMAL', () => {
    const initial = createEnergy(0.7);
    const normal = stepEnergy(initial, { throttle: 1, brake: 0, speed: 90, mode: 'NORMAL' }, 1);
    const deploy = stepEnergy(initial, { throttle: 1, brake: 0, speed: 90, mode: 'DEPLOY' }, 1);

    expect(deploy.soc).toBeLessThan(normal.soc - 0.06);
    expect(deploy.powerBoost).toBeGreaterThan(0.3);
    expect(deploy.powerBoost).toBeGreaterThan(normal.powerBoost * 4);
  });

  it('recovers charge strongly under braking', () => {
    const initial = createEnergy(0.4);
    const next = stepEnergy(initial, { throttle: 0, brake: 1, speed: 75, mode: 'NORMAL' }, 1);

    expect(next.soc).toBeGreaterThan(initial.soc);
    expect(next.harvesting).toBeGreaterThan(0.08);
  });

  it('cannot provide DEPLOY boost from an empty battery', () => {
    const empty = createEnergy(0);
    const next = stepEnergy(empty, { throttle: 1, brake: 0, speed: 90, mode: 'DEPLOY' }, 1);

    expect(next.soc).toBe(0);
    expect(next.powerBoost).toBe(0);
  });
});
