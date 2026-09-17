import { describe, expect, it } from 'vitest';
import {
  PitwallNeuralPolicy,
  createPitwallNeuralPolicyData,
  policyDataFromParameters,
  policyParameterCount,
  PITWALL_LEARNING_OBSERVATION_SIZE,
} from './PitwallNeuralPolicy';

describe('Pitwall neural policy', () => {
  it('round-trips its flat parameter representation deterministically', () => {
    const count = policyParameterCount();
    expect(count).toBeGreaterThan(400);
    expect(count).toBeLessThan(700);

    const parameters = Array.from({ length: count }, (_, index) => Math.sin(index * 0.17) * 0.05);
    const policy = new PitwallNeuralPolicy(policyDataFromParameters(parameters));
    expect(policy.parameters()).toEqual(parameters);

    const observation = new Array(PITWALL_LEARNING_OBSERVATION_SIZE).fill(0.1);
    const first = policy.act(observation);
    const second = new PitwallNeuralPolicy(policy.data).act(observation);
    expect(second).toEqual(first);
    expect(Math.abs(first.steer)).toBeLessThanOrEqual(1);
    expect(first.throttle).toBeGreaterThanOrEqual(0);
    expect(first.throttle).toBeLessThanOrEqual(1);
    expect(first.brake).toBeGreaterThanOrEqual(0);
    expect(first.brake).toBeLessThanOrEqual(1);
  });

  it('rejects malformed exported policies', () => {
    const data = createPitwallNeuralPolicyData();
    data.layers[0].weights.pop();
    expect(() => new PitwallNeuralPolicy(data)).toThrow(/weight count/i);
  });
});
