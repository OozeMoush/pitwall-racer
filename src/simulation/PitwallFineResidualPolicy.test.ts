import { describe, expect, it } from 'vitest';
import {
  applyPitwallFineResidual,
  createPitwallFineResidualPolicyData,
  PITWALL_FINE_RESIDUAL_PARAMETER_COUNT,
} from './PitwallFineResidualPolicy';

describe('Pitwall fine residual policy', () => {
  it('preserves the coarse action exactly at the zero genome', () => {
    const data = createPitwallFineResidualPolicyData();
    expect(data.parameters).toHaveLength(PITWALL_FINE_RESIDUAL_PARAMETER_COUNT);
    const base = { steer: -0.18, throttle: 0.64, brake: 0.07 };
    expect(applyPitwallFineResidual(base, 0.613, data)).toEqual(base);
  });

  it('keeps physical actuators bounded under extreme fine corrections', () => {
    const data = createPitwallFineResidualPolicyData();
    data.parameters.fill(100);
    const action = applyPitwallFineResidual(
      { steer: 0.99, throttle: 0.99, brake: 0.99 },
      0.5,
      data,
    );
    expect(action.steer).toBeLessThanOrEqual(1);
    expect(action.throttle).toBeLessThanOrEqual(1);
    expect(action.brake).toBeLessThanOrEqual(1);
  });
});
