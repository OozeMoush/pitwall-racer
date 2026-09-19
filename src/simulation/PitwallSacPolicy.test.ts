import { describe, expect, it } from 'vitest';
import {
  PITWALL_LEARNING_ACTION_SIZE,
  PITWALL_LEARNING_OBSERVATION_SIZE,
  type NeuralLayerData,
} from './PitwallNeuralPolicy';
import {
  PitwallSacPolicy,
  PITWALL_SAC_HIDDEN_SIZES,
  type PitwallSacPolicyData,
} from './PitwallSacPolicy';

describe('Pitwall SAC policy', () => {
  it('maps zero deterministic means onto bounded physical actuators', () => {
    const policy = new PitwallSacPolicy(zeroPolicy());
    const action = policy.act(
      new Array(PITWALL_LEARNING_OBSERVATION_SIZE).fill(0),
    );

    expect(action.steer).toBe(0);
    expect(action.throttle).toBe(0.5);
    expect(action.brake).toBe(0.5);
  });

  it('uses tanh(mean) for deterministic deployment', () => {
    const data = zeroPolicy();
    data.meanLayer.biases = [2, 1, -2];
    const policy = new PitwallSacPolicy(data);
    const normalized = policy.normalizedAction(
      new Array(PITWALL_LEARNING_OBSERVATION_SIZE).fill(0),
    );

    expect(normalized[0]).toBeCloseTo(Math.tanh(2), 12);
    expect(normalized[1]).toBeCloseTo(Math.tanh(1), 12);
    expect(normalized[2]).toBeCloseTo(Math.tanh(-2), 12);

    const physical = policy.act(
      new Array(PITWALL_LEARNING_OBSERVATION_SIZE).fill(0),
    );
    expect(physical.steer).toBeLessThanOrEqual(1);
    expect(physical.throttle).toBeGreaterThan(0.5);
    expect(physical.brake).toBeLessThan(0.5);
  });

  it('rejects a mismatched actor architecture', () => {
    const data = zeroPolicy();
    data.hiddenSizes = [64, 64];
    expect(() => new PitwallSacPolicy(data)).toThrow(
      'Unsupported SAC hidden sizes',
    );
  });
});

function zeroPolicy(): PitwallSacPolicyData {
  const hiddenLayers: NeuralLayerData[] = [];
  let input = PITWALL_LEARNING_OBSERVATION_SIZE;
  for (const output of PITWALL_SAC_HIDDEN_SIZES) {
    hiddenLayers.push(zeroLayer(input, output));
    input = output;
  }
  return {
    version: 1,
    observationSize: PITWALL_LEARNING_OBSERVATION_SIZE,
    actionSize: PITWALL_LEARNING_ACTION_SIZE,
    hiddenSizes: [...PITWALL_SAC_HIDDEN_SIZES],
    hiddenLayers,
    meanLayer: zeroLayer(input, PITWALL_LEARNING_ACTION_SIZE),
  };
}

function zeroLayer(inputSize: number, outputSize: number): NeuralLayerData {
  return {
    inputSize,
    outputSize,
    weights: new Array(inputSize * outputSize).fill(0),
    biases: new Array(outputSize).fill(0),
  };
}
