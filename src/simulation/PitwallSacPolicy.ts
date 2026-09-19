import {
  PITWALL_LEARNING_ACTION_SIZE,
  PITWALL_LEARNING_OBSERVATION_SIZE,
  type NeuralLayerData,
  type PitwallLearningAction,
} from './PitwallNeuralPolicy';

export const PITWALL_SAC_HIDDEN_SIZES = [128, 128] as const;

export interface PitwallSacPolicyData {
  version: 1;
  observationSize: number;
  actionSize: number;
  hiddenSizes: number[];
  hiddenLayers: NeuralLayerData[];
  meanLayer: NeuralLayerData;
}

/**
 * Deterministic deployment view of a Soft Actor-Critic policy.
 *
 * Training also has a log-standard-deviation head for exploration. Deployment
 * uses tanh(mean), matching SAC's standard deterministic evaluation action.
 */
export class PitwallSacPolicy {
  readonly data: PitwallSacPolicyData;

  constructor(data: PitwallSacPolicyData) {
    validatePitwallSacPolicyData(data);
    this.data = cloneData(data);
  }

  normalizedAction(observation: readonly number[]): number[] {
    if (observation.length !== this.data.observationSize) {
      throw new Error(
        `Expected ${this.data.observationSize} observations, got ${observation.length}`,
      );
    }

    let values = [...observation];
    for (const layer of this.data.hiddenLayers) {
      values = dense(layer, values).map((value) => Math.max(0, value));
    }
    return dense(this.data.meanLayer, values).map(Math.tanh);
  }

  act(observation: readonly number[]): PitwallLearningAction {
    const action = this.normalizedAction(observation);
    return {
      steer: clamp(action[0] ?? 0, -1, 1),
      throttle: clamp(((action[1] ?? -1) + 1) * 0.5, 0, 1),
      brake: clamp(((action[2] ?? -1) + 1) * 0.5, 0, 1),
    };
  }
}

export function validatePitwallSacPolicyData(
  data: PitwallSacPolicyData,
): void {
  if (data.version !== 1) {
    throw new Error(`Unsupported SAC policy version: ${data.version}`);
  }
  if (data.observationSize !== PITWALL_LEARNING_OBSERVATION_SIZE) {
    throw new Error(
      `Unsupported SAC observation size: ${data.observationSize}`,
    );
  }
  if (data.actionSize !== PITWALL_LEARNING_ACTION_SIZE) {
    throw new Error(
      `Unsupported SAC action size: ${data.actionSize}`,
    );
  }
  if (
    data.hiddenSizes.length !== PITWALL_SAC_HIDDEN_SIZES.length
    || data.hiddenSizes.some(
      (size, index) => size !== PITWALL_SAC_HIDDEN_SIZES[index],
    )
  ) {
    throw new Error(
      `Unsupported SAC hidden sizes: ${data.hiddenSizes.join(',')}`,
    );
  }
  if (data.hiddenLayers.length !== data.hiddenSizes.length) {
    throw new Error('SAC hidden layer count mismatch');
  }

  let expectedInput = data.observationSize;
  for (let index = 0; index < data.hiddenLayers.length; index++) {
    const layer = data.hiddenLayers[index];
    validateLayer(layer, expectedInput, data.hiddenSizes[index]);
    expectedInput = layer.outputSize;
  }
  validateLayer(
    data.meanLayer,
    expectedInput,
    data.actionSize,
  );
}

function validateLayer(
  layer: NeuralLayerData,
  expectedInput: number,
  expectedOutput: number,
): void {
  if (
    layer.inputSize !== expectedInput
    || layer.outputSize !== expectedOutput
  ) {
    throw new Error('SAC policy layer shape mismatch');
  }
  if (layer.weights.length !== layer.inputSize * layer.outputSize) {
    throw new Error('SAC policy weight count mismatch');
  }
  if (layer.biases.length !== layer.outputSize) {
    throw new Error('SAC policy bias count mismatch');
  }
  if (![...layer.weights, ...layer.biases].every(Number.isFinite)) {
    throw new Error('SAC policy contains non-finite parameters');
  }
}

function dense(
  layer: NeuralLayerData,
  input: readonly number[],
): number[] {
  const output = new Array<number>(layer.outputSize).fill(0);
  for (let row = 0; row < layer.outputSize; row++) {
    let value = layer.biases[row];
    const base = row * layer.inputSize;
    for (let column = 0; column < layer.inputSize; column++) {
      value += layer.weights[base + column] * input[column];
    }
    output[row] = value;
  }
  return output;
}

function cloneData(data: PitwallSacPolicyData): PitwallSacPolicyData {
  return {
    ...data,
    hiddenSizes: [...data.hiddenSizes],
    hiddenLayers: data.hiddenLayers.map((layer) => ({
      ...layer,
      weights: [...layer.weights],
      biases: [...layer.biases],
    })),
    meanLayer: {
      ...data.meanLayer,
      weights: [...data.meanLayer.weights],
      biases: [...data.meanLayer.biases],
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
