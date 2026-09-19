import type { PitwallLearningAction } from './PitwallNeuralPolicy';

export const PITWALL_FINE_RESIDUAL_KNOTS = 64;
export const PITWALL_FINE_RESIDUAL_CHANNELS = 3;
export const PITWALL_FINE_RESIDUAL_PARAMETER_COUNT =
  PITWALL_FINE_RESIDUAL_KNOTS * PITWALL_FINE_RESIDUAL_CHANNELS;

export interface PitwallFineResidualPolicyData {
  version: 1;
  knots: number;
  parameters: number[];
  steerScale: number;
  throttleScale: number;
  brakeScale: number;
}

export function createPitwallFineResidualPolicyData(): PitwallFineResidualPolicyData {
  return {
    version: 1,
    knots: PITWALL_FINE_RESIDUAL_KNOTS,
    parameters: new Array(PITWALL_FINE_RESIDUAL_PARAMETER_COUNT).fill(0),
    // This layer sits on top of an already optimized 32-knot controller, so its
    // authority is deliberately smaller. At zero it preserves the coarse policy
    // exactly; evolution only searches local timing/detail corrections.
    steerScale: 0.04,
    throttleScale: 0.10,
    brakeScale: 0.10,
  };
}

export function validatePitwallFineResidualPolicyData(
  data: PitwallFineResidualPolicyData,
): void {
  if (data.version !== 1) throw new Error(`Unsupported fine residual version: ${data.version}`);
  if (data.knots !== PITWALL_FINE_RESIDUAL_KNOTS) {
    throw new Error(`Unsupported fine residual knot count: ${data.knots}`);
  }
  if (data.parameters.length !== PITWALL_FINE_RESIDUAL_PARAMETER_COUNT) {
    throw new Error(
      `Expected ${PITWALL_FINE_RESIDUAL_PARAMETER_COUNT} fine residual parameters, got ${data.parameters.length}`,
    );
  }
  if (![...data.parameters, data.steerScale, data.throttleScale, data.brakeScale].every(Number.isFinite)) {
    throw new Error('Fine residual policy contains non-finite values');
  }
}

export function applyPitwallFineResidual(
  base: PitwallLearningAction,
  progress: number,
  data: PitwallFineResidualPolicyData,
): PitwallLearningAction {
  validatePitwallFineResidualPolicyData(data);

  const steerResidual = interpolateChannel(data.parameters, progress, 0);
  const throttleResidual = interpolateChannel(data.parameters, progress, 1);
  const brakeResidual = interpolateChannel(data.parameters, progress, 2);

  return {
    steer: clamp(base.steer + data.steerScale * Math.tanh(steerResidual), -1, 1),
    throttle: clamp(base.throttle + data.throttleScale * Math.tanh(throttleResidual), 0, 1),
    brake: clamp(base.brake + data.brakeScale * Math.tanh(brakeResidual), 0, 1),
  };
}

export function fineResidualDataWithParameters(
  base: PitwallFineResidualPolicyData,
  parameters: readonly number[],
): PitwallFineResidualPolicyData {
  if (parameters.length !== PITWALL_FINE_RESIDUAL_PARAMETER_COUNT) {
    throw new Error(
      `Expected ${PITWALL_FINE_RESIDUAL_PARAMETER_COUNT} fine residual parameters, got ${parameters.length}`,
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
  const scaled = wrapped * PITWALL_FINE_RESIDUAL_KNOTS;
  const left = Math.floor(scaled) % PITWALL_FINE_RESIDUAL_KNOTS;
  const right = (left + 1) % PITWALL_FINE_RESIDUAL_KNOTS;
  const t = scaled - Math.floor(scaled);
  const leftValue = parameters[left * PITWALL_FINE_RESIDUAL_CHANNELS + channel] ?? 0;
  const rightValue = parameters[right * PITWALL_FINE_RESIDUAL_CHANNELS + channel] ?? 0;
  const smooth = t * t * (3 - 2 * t);
  return leftValue + (rightValue - leftValue) * smooth;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
