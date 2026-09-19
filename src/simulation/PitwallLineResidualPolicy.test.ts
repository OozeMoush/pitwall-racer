import { describe, expect, it } from 'vitest';
import {
  applyPitwallLineResidual,
  createPitwallLineResidualPolicyData,
  PITWALL_LINE_RESIDUAL_PARAMETER_COUNT,
  samplePitwallLineResidual,
} from './PitwallLineResidualPolicy';

describe('Pitwall line residual policy', () => {
  it('preserves the base line exactly at the zero genome', () => {
    const data = createPitwallLineResidualPolicyData();
    expect(data.parameters).toHaveLength(PITWALL_LINE_RESIDUAL_PARAMETER_COUNT);
    const base = [0, 1.2, -0.7, 3.4, -2.1];
    expect(applyPitwallLineResidual(base, data)).toEqual(base);
  });

  it('wraps smoothly around the lap boundary', () => {
    const data = createPitwallLineResidualPolicyData();
    data.parameters[0] = 0.5;
    data.parameters[data.parameters.length - 1] = 0.5;
    const before = samplePitwallLineResidual(data, 0.9999);
    const after = samplePitwallLineResidual(data, 0.0001);
    expect(Math.abs(before - after)).toBeLessThan(0.01);
  });

  it('bounds physical lane correction with tanh', () => {
    const data = createPitwallLineResidualPolicyData();
    data.parameters.fill(100);
    const correction = samplePitwallLineResidual(data, 0.42);
    expect(correction).toBeLessThanOrEqual(data.laneScale);
    expect(correction).toBeGreaterThan(0);
  });
});
