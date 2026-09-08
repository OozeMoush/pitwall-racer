import { describe, expect, it } from 'vitest';
import { stepSteering } from './InputModel';

describe('stepSteering', () => {
  it('responds quickly at low speed but softens initial input at high speed', () => {
    const low = stepSteering(0, 1, 20, 0.1);
    const high = stepSteering(0, 1, 95, 0.1);
    expect(low).toBeGreaterThan(high);
    expect(low).toBeLessThanOrEqual(1);
    expect(high).toBeGreaterThan(0);
  });

  it('recentres faster than it adds lock', () => {
    const addLock = stepSteering(0, 1, 60, 0.05);
    const recenter = stepSteering(addLock, 0, 60, 0.05);
    expect(Math.abs(recenter)).toBeLessThan(Math.abs(addLock));
  });
});
