import type { PitwallLearningAction } from './PitwallNeuralPolicy';

export const PITWALL_RESIDUAL_KNOTS = 32;
export const PITWALL_RESIDUAL_CHANNELS = 3;
export const PITWALL_RESIDUAL_PARAMETER_COUNT =
  PITWALL_RESIDUAL_KNOTS * PITWALL_RESIDUAL_CHANNELS;

export interface PitwallResidualPolicyData {
  version: 1;
  knots: number;
  parameters: number[];
  steerScale: number;
  throttleScale: number;
  brakeScale: number;
}

export function createPitwallResidualPolicyData(): PitwallResidualPolicyData {
  return {
    version: 1,
    knots: PITWALL_RESIDUAL_KNOTS,
    parameters: new Array(PITWALL_RESIDUAL_PARAMETER_COUNT).fill(0),
    // Residuals are deliberately bounded in physical actuator space. The
    // frozen neural clone supplies the stable feedback policy while evolution
    // searches only small track-local control improvements.
    steerScale: 0.08,
    throttleScale: 0.20,
    brakeScale: 0.20,
  };
}

export function validatePitwallResidualPolicyData(data: PitwallResidualPolicyData): void {
  if (data.version !== 1) throw new Error(`Unsupported residual version: ${data.version}`);
  if (data.knots !== PITWALL_RESIDUAL_KNOTS) {
    throw new Error(`Unsupported residual knot count: ${data.knots}`);
  }
  if (data.parameters.length !== PITWALL_RESIDUAL_PARAMETER_COUNT) {
    throw new Error(
      `Expected ${PITWALL_RESIDUAL_PARAMETER_COUNT} residual parameters, got ${data.parameters.length}`,
    );
  }
  if (![...data.parameters, data.steerScale, data.throttleScale, data.brakeScale].every(Number.isFinite)) {
    throw new Error('Residual policy contains non-finite values');
  }
}

export function applyPitwallResidual(
  base: PitwallLearningAction,
  progress: number,
  data: PitwallResidualPolicyData,
): PitwallLearningAction {
  validatePitwallResidualPolicyData(data);

  const steerResidual = interpolateChannel(data.parameters, progress, 0);
  const throttleResidual = interpolateChannel(data.parameters, progress, 1);
  const brakeResidual = interpolateChannel(data.parameters, progress, 2);

  return {
    steer: clamp(base.steer + data.steerScale * Math.tanh(steerResidual), -1, 1),
    throttle: clamp(base.throttle + data.throttleScale * Math.tanh(throttleResidual), 0, 1),
    brake: clamp(base.brake + data.brakeScale * Math.tanh(brakeResidual), 0, 1),
  };
}

export function residualDataWithParameters(
  base: PitwallResidualPolicyData,
  parameters: readonly number[],
): PitwallResidualPolicyData {
  if (parameters.length !== PITWALL_RESIDUAL_PARAMETER_COUNT) {
    throw new Error(
      `Expected ${PITWALL_RESIDUAL_PARAMETER_COUNT} residual parameters, got ${parameters.length}`,
    );
  }
  return {
    ...base,
    parameters: [...parameters],
  };
}

function interpolateChannel(
  parameters: readonly number[],
  progress: number,
  channel: number,
): number {
  const wrapped = ((progress % 1) + 1) % 1;
  const scaled = wrapped * PITWALL_RESIDUAL_KNOTS;
  const left = Math.floor(scaled) % PITWALL_RESIDUAL_KNOTS;
  const right = (left + 1) % PITWALL_RESIDUAL_KNOTS;
  const t = scaled - Math.floor(scaled);

  const leftValue = parameters[left * PITWALL_RESIDUAL_CHANNELS + channel] ?? 0;
  const rightValue = parameters[right * PITWALL_RESIDUAL_CHANNELS + channel] ?? 0;
  // Smoothstep keeps the derivative continuous enough for neighboring knots
  // not to introduce a sharp steering/throttle edge.
  const smooth = t * t * (3 - 2 * t);
  return leftValue + (rightValue - leftValue) * smooth;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
