import { describe, expect, it } from 'vitest';
import {
  applyPitwallResidual,
  createPitwallResidualPolicyData,
  PITWALL_RESIDUAL_PARAMETER_COUNT,
} from './PitwallResidualPolicy';

describe('Pitwall residual policy', () => {
  it('preserves the base action exactly at the zero genome', () => {
    const data = createPitwallResidualPolicyData();
    expect(data.parameters).toHaveLength(PITWALL_RESIDUAL_PARAMETER_COUNT);
    const base = { steer: 0.12, throttle: 0.73, brake: 0.04 };
    expect(applyPitwallResidual(base, 0.347, data)).toEqual(base);
  });

  it('keeps physical actuators bounded under extreme residual parameters', () => {
    const data = createPitwallResidualPolicyData();
    data.parameters.fill(100);
    const action = applyPitwallResidual(
      { steer: 0.98, throttle: 0.98, brake: 0.98 },
      0.5,
      data,
    );
    expect(action.steer).toBeLessThanOrEqual(1);
    expect(action.throttle).toBeLessThanOrEqual(1);
    expect(action.brake).toBeLessThanOrEqual(1);
  });
});
