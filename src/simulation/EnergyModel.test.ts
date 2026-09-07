import { describe, expect, it } from 'vitest';
import { createEnergy, stepEnergy } from './EnergyModel';

describe('EnergyModel', () => {
  it('spends substantially more charge in overtake mode', () => {
    const initial = createEnergy(0.7);
    const balanced = stepEnergy(initial, { throttle: 1, brake: 0, speed: 70, overtakeRequested: false }, 1);
    const overtake = stepEnergy(initial, { throttle: 1, brake: 0, speed: 70, overtakeRequested: true }, 1);

    expect(overtake.soc).toBeLessThan(balanced.soc);
    expect(overtake.powerBoost).toBeGreaterThan(balanced.powerBoost);
    expect(overtake.overtakeActive).toBe(true);
  });

  it('recovers charge under braking', () => {
    const initial = createEnergy(0.4);
    const next = stepEnergy(initial, { throttle: 0, brake: 1, speed: 65, overtakeRequested: false }, 1);

    expect(next.soc).toBeGreaterThan(initial.soc);
    expect(next.harvesting).toBeGreaterThan(0);
  });

  it('cannot provide meaningful overtake boost from an empty battery', () => {
    const empty = createEnergy(0);
    const next = stepEnergy(empty, { throttle: 1, brake: 0, speed: 70, overtakeRequested: true }, 1);

    expect(next.soc).toBe(0);
    expect(next.powerBoost).toBe(0);
    expect(next.overtakeActive).toBe(false);
  });
});
