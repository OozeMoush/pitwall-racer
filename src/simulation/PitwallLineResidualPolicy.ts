export const PITWALL_LINE_RESIDUAL_KNOTS = 32;
export const PITWALL_LINE_RESIDUAL_PARAMETER_COUNT = PITWALL_LINE_RESIDUAL_KNOTS;

export interface PitwallLineResidualPolicyData {
  version: 1;
  knots: number;
  parameters: number[];
  laneScale: number;
}

export function createPitwallLineResidualPolicyData(): PitwallLineResidualPolicyData {
  return {
    version: 1,
    knots: PITWALL_LINE_RESIDUAL_KNOTS,
    parameters: new Array(PITWALL_LINE_RESIDUAL_PARAMETER_COUNT).fill(0),
    // Lane offset is in world metres. The tanh keeps the search bounded while
    // still allowing the optimizer to use kerb/runoff when the physical model
    // says that is faster. Hard validity remains in the learning environment.
    laneScale: 2.0,
  };
}

export function validatePitwallLineResidualPolicyData(
  data: PitwallLineResidualPolicyData,
): void {
  if (data.version !== 1) throw new Error(`Unsupported line residual version: ${data.version}`);
  if (data.knots !== PITWALL_LINE_RESIDUAL_KNOTS) {
    throw new Error(`Unsupported line residual knot count: ${data.knots}`);
  }
  if (data.parameters.length !== PITWALL_LINE_RESIDUAL_PARAMETER_COUNT) {
    throw new Error(
      `Expected ${PITWALL_LINE_RESIDUAL_PARAMETER_COUNT} line residual parameters, got ${data.parameters.length}`,
    );
  }
  if (![...data.parameters, data.laneScale].every(Number.isFinite)) {
    throw new Error('Line residual contains non-finite values');
  }
}

export function lineResidualDataWithParameters(
  base: PitwallLineResidualPolicyData,
  parameters: readonly number[],
): PitwallLineResidualPolicyData {
  if (parameters.length !== PITWALL_LINE_RESIDUAL_PARAMETER_COUNT) {
    throw new Error(
      `Expected ${PITWALL_LINE_RESIDUAL_PARAMETER_COUNT} line residual parameters, got ${parameters.length}`,
    );
  }
  return {
    ...base,
    parameters: [...parameters],
  };
}

export function applyPitwallLineResidual(
  baseLanes: readonly number[],
  data: PitwallLineResidualPolicyData,
): number[] {
  validatePitwallLineResidualPolicyData(data);
  if (baseLanes.length === 0) return [];

  return baseLanes.map((lane, index) => {
    const progress = index / baseLanes.length;
    const residual = sampleLineResidual(data.parameters, progress);
    return lane + data.laneScale * Math.tanh(residual);
  });
}

export function samplePitwallLineResidual(
  data: PitwallLineResidualPolicyData,
  progress: number,
): number {
  validatePitwallLineResidualPolicyData(data);
  return data.laneScale * Math.tanh(sampleLineResidual(data.parameters, progress));
}

function sampleLineResidual(parameters: readonly number[], progress: number): number {
  const wrapped = ((progress % 1) + 1) % 1;
  const scaled = wrapped * PITWALL_LINE_RESIDUAL_KNOTS;
  const left = Math.floor(scaled) % PITWALL_LINE_RESIDUAL_KNOTS;
  const right = (left + 1) % PITWALL_LINE_RESIDUAL_KNOTS;
  const t = scaled - Math.floor(scaled);
  const a = parameters[left] ?? 0;
  const b = parameters[right] ?? 0;
  const smooth = t * t * (3 - 2 * t);
  return a + (b - a) * smooth;
}
