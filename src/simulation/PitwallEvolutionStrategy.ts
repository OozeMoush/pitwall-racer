export interface AdamAscentState {
  firstMoment: number[];
  secondMoment: number[];
  step: number;
}

/**
 * Convert an arbitrary strict ordering into zero-sum centered utilities.
 * The values encode rank only; the magnitude of lap-time/off-track differences
 * never enters the optimizer, preserving the lexicographic validity semantics.
 */
export function centeredRankUtilities<T>(
  items: readonly T[],
  compare: (a: T, b: T) => number,
): number[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [0];

  const order = items.map((_, index) => index);
  order.sort((left, right) => compare(items[left], items[right]));
  const utilities = new Array<number>(items.length).fill(0);
  for (let rank = 0; rank < order.length; rank++) {
    utilities[order[rank]] = 0.5 - rank / (order.length - 1);
  }
  return utilities;
}

export function createAdamAscentState(size: number): AdamAscentState {
  return {
    firstMoment: new Array(size).fill(0),
    secondMoment: new Array(size).fill(0),
    step: 0,
  };
}

/** Apply one Adam-ascent step in-place and return the updated parameter vector. */
export function adamAscent(
  parameters: readonly number[],
  gradient: readonly number[],
  state: AdamAscentState,
  learningRate: number,
  beta1 = 0.9,
  beta2 = 0.999,
  epsilon = 1e-8,
): number[] {
  if (parameters.length !== gradient.length
    || parameters.length !== state.firstMoment.length
    || parameters.length !== state.secondMoment.length) {
    throw new Error('Adam vector size mismatch');
  }

  state.step += 1;
  const bias1 = 1 - Math.pow(beta1, state.step);
  const bias2 = 1 - Math.pow(beta2, state.step);
  const next = new Array<number>(parameters.length);
  for (let index = 0; index < parameters.length; index++) {
    const g = gradient[index];
    const first = beta1 * state.firstMoment[index] + (1 - beta1) * g;
    const second = beta2 * state.secondMoment[index] + (1 - beta2) * g * g;
    state.firstMoment[index] = first;
    state.secondMoment[index] = second;
    const firstHat = first / bias1;
    const secondHat = second / bias2;
    next[index] = parameters[index] + learningRate * firstHat / (Math.sqrt(secondHat) + epsilon);
  }
  return next;
}
