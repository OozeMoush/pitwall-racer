export const PITWALL_LEARNING_OBSERVATION_SIZE = 18;
export const PITWALL_LEARNING_ACTION_SIZE = 3;
export const PITWALL_POLICY_HIDDEN_SIZES = [16, 16] as const;

export interface NeuralLayerData {
  inputSize: number;
  outputSize: number;
  /** Row-major [output][input]. */
  weights: number[];
  biases: number[];
}

export interface PitwallNeuralPolicyData {
  version: 1;
  observationSize: number;
  actionSize: number;
  hiddenSizes: number[];
  layers: NeuralLayerData[];
}

export interface PitwallLearningAction {
  steer: number;
  throttle: number;
  brake: number;
}

/**
 * Tiny deterministic MLP used by the learned Pitwall driver.
 *
 * The output preserves the game's three real actuator channels instead of
 * collapsing throttle/brake into a signed scalar. That matters at the closed-
 * loop stability boundary, and lets behavior cloning reproduce the machine
 * teacher without changing its control space before learning even begins.
 *
 * Keeping inference in TypeScript means candidates are evaluated by the exact
 * same Rapier/game code as the player rather than by a Python physics clone.
 * Training code may run in PyTorch/CUDA and export this deliberately simple
 * JSON representation.
 */
export class PitwallNeuralPolicy {
  readonly data: PitwallNeuralPolicyData;

  constructor(data: PitwallNeuralPolicyData) {
    validatePolicyData(data);
    this.data = clonePolicyData(data);
  }

  act(observation: readonly number[]): PitwallLearningAction {
    if (observation.length !== this.data.observationSize) {
      throw new Error(`Expected ${this.data.observationSize} observations, got ${observation.length}`);
    }

    let values = [...observation];
    for (const layer of this.data.layers) {
      const next = new Array<number>(layer.outputSize).fill(0);
      for (let output = 0; output < layer.outputSize; output++) {
        let sum = layer.biases[output];
        const row = output * layer.inputSize;
        for (let input = 0; input < layer.inputSize; input++) {
          sum += layer.weights[row + input] * values[input];
        }
        next[output] = Math.tanh(sum);
      }
      values = next;
    }

    // Steer naturally lives in [-1, 1]. Throttle and brake use the same tanh
    // network output but are mapped smoothly onto [0, 1], so the trainer can
    // represent exact physical actuator targets without a dead clamp region.
    return {
      steer: clamp(values[0] ?? 0, -1, 1),
      throttle: clamp(((values[1] ?? -1) + 1) * 0.5, 0, 1),
      brake: clamp(((values[2] ?? -1) + 1) * 0.5, 0, 1),
    };
  }

  parameters(): number[] {
    const flat: number[] = [];
    for (const layer of this.data.layers) {
      flat.push(...layer.weights, ...layer.biases);
    }
    return flat;
  }

  withParameters(parameters: readonly number[]): PitwallNeuralPolicy {
    return new PitwallNeuralPolicy(policyDataFromParameters(parameters));
  }
}

export function createPitwallNeuralPolicyData(fill = 0): PitwallNeuralPolicyData {
  const sizes = [
    PITWALL_LEARNING_OBSERVATION_SIZE,
    ...PITWALL_POLICY_HIDDEN_SIZES,
    PITWALL_LEARNING_ACTION_SIZE,
  ];
  const layers: NeuralLayerData[] = [];
  for (let index = 0; index < sizes.length - 1; index++) {
    const inputSize = sizes[index];
    const outputSize = sizes[index + 1];
    layers.push({
      inputSize,
      outputSize,
      weights: new Array(inputSize * outputSize).fill(fill),
      biases: new Array(outputSize).fill(fill),
    });
  }
  return {
    version: 1,
    observationSize: PITWALL_LEARNING_OBSERVATION_SIZE,
    actionSize: PITWALL_LEARNING_ACTION_SIZE,
    hiddenSizes: [...PITWALL_POLICY_HIDDEN_SIZES],
    layers,
  };
}

export function policyDataFromParameters(parameters: readonly number[]): PitwallNeuralPolicyData {
  const data = createPitwallNeuralPolicyData();
  const expected = policyParameterCount(data);
  if (parameters.length !== expected) {
    throw new Error(`Expected ${expected} policy parameters, got ${parameters.length}`);
  }

  let cursor = 0;
  for (const layer of data.layers) {
    for (let index = 0; index < layer.weights.length; index++) {
      layer.weights[index] = parameters[cursor++];
    }
    for (let index = 0; index < layer.biases.length; index++) {
      layer.biases[index] = parameters[cursor++];
    }
  }
  return data;
}

export function policyParameterCount(data = createPitwallNeuralPolicyData()): number {
  return data.layers.reduce(
    (sum, layer) => sum + layer.weights.length + layer.biases.length,
    0,
  );
}

function validatePolicyData(data: PitwallNeuralPolicyData): void {
  if (data.version !== 1) throw new Error(`Unsupported policy version: ${data.version}`);
  if (data.observationSize !== PITWALL_LEARNING_OBSERVATION_SIZE) {
    throw new Error(`Unsupported observation size: ${data.observationSize}`);
  }
  if (data.actionSize !== PITWALL_LEARNING_ACTION_SIZE) {
    throw new Error(`Unsupported action size: ${data.actionSize}`);
  }
  if (data.layers.length !== 3) throw new Error(`Expected 3 policy layers, got ${data.layers.length}`);

  let expectedInput = data.observationSize;
  for (const layer of data.layers) {
    if (layer.inputSize !== expectedInput) throw new Error('Policy layer input size mismatch');
    if (layer.weights.length !== layer.inputSize * layer.outputSize) {
      throw new Error('Policy weight count mismatch');
    }
    if (layer.biases.length !== layer.outputSize) throw new Error('Policy bias count mismatch');
    if (![...layer.weights, ...layer.biases].every(Number.isFinite)) {
      throw new Error('Policy contains non-finite parameters');
    }
    expectedInput = layer.outputSize;
  }
  if (expectedInput !== data.actionSize) throw new Error('Policy output size mismatch');
}

function clonePolicyData(data: PitwallNeuralPolicyData): PitwallNeuralPolicyData {
  return {
    ...data,
    hiddenSizes: [...data.hiddenSizes],
    layers: data.layers.map((layer) => ({
      ...layer,
      weights: [...layer.weights],
      biases: [...layer.biases],
    })),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
