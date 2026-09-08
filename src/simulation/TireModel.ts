export type Compound = 'SOFT' | 'MEDIUM' | 'HARD';
export type PaceMode = 'CONSERVE' | 'BALANCED' | 'PUSH';

export interface TireState {
  compound: Compound;
  wear: number;
  temperature: number;
  grip: number;
}

const compound = {
  SOFT: { baseGrip: 1.075, wear: 1.65, ideal: 102 },
  MEDIUM: { baseGrip: 1.0, wear: 1.0, ideal: 97 },
  HARD: { baseGrip: 0.94, wear: 0.62, ideal: 91 },
} satisfies Record<Compound, { baseGrip: number; wear: number; ideal: number }>;

const pace = {
  CONSERVE: { wear: 0.64, heat: -2.2, grip: 0.985 },
  BALANCED: { wear: 1, heat: 0, grip: 1 },
  PUSH: { wear: 1.52, heat: 4.4, grip: 1.02 },
} satisfies Record<PaceMode, { wear: number; heat: number; grip: number }>;

export function createTire(compoundName: Compound): TireState {
  const spec = compound[compoundName];
  return {
    compound: compoundName,
    wear: 0,
    temperature: spec.ideal - 9,
    grip: spec.baseGrip * 0.95,
  };
}

/**
 * Deliberately game-facing tyre model.
 *
 * A fresh tyre should be easy to trust. A used tyre must become something the
 * player can feel without staring at a percentage: it overheats more easily,
 * gives away corner/brake/traction authority through `grip`, and develops a
 * clear late-stint cliff. In an eight-lap race a Medium can physically survive
 * to the flag, but doing so should be slower than making a sensible stop.
 */
export function stepTire(state: TireState, mode: PaceMode, load: number, dt: number): TireState {
  const spec = compound[state.compound];
  const map = pace[mode];
  const safeLoad = Math.max(0, Math.min(1.35, load));

  // Load now creates a wider temperature swing. Holding full throttle through
  // repeated corners can cook the tyre for a while even before wear is severe.
  const targetTemp = spec.ideal + map.heat + safeLoad * 13.5 + state.wear * 3.5;
  const temperature = state.temperature
    + (targetTemp - state.temperature) * Math.min(1, dt * 0.46);
  const tempDelta = Math.abs(temperature - spec.ideal);
  const heatWear = 1 + Math.max(0, temperature - spec.ideal - 5) * 0.018;

  // Medium at representative racing load reaches a meaningful late-life phase
  // around laps 5-6. Soft gets there sooner; Hard trades initial grip for life.
  const wearRate = 0.00225
    * spec.wear
    * map.wear
    * (0.42 + safeLoad * 0.9)
    * heatWear;
  const wear = Math.min(1, state.wear + wearRate * dt);

  // Gentle early degradation, then a readable cliff. This is intentionally
  // stronger than a simulation-scale F1 model because the race is only 8 laps.
  const baseWearLoss = wear * 0.12;
  const lateWear = Math.max(0, wear - 0.52);
  const cliff = Math.pow(lateWear, 1.35) * 1.25;
  const temperatureLoss = Math.max(0, tempDelta - 4) * 0.0075;
  const tempGrip = Math.max(0.72, 1 - temperatureLoss);
  const wearGrip = Math.max(0.5, 1 - baseWearLoss - cliff);
  const grip = Math.max(0.48, spec.baseGrip * map.grip * tempGrip * wearGrip);

  return { ...state, wear, temperature, grip };
}

export function compoundColor(name: Compound): number {
  return name === 'SOFT' ? 0xff4054 : name === 'MEDIUM' ? 0xffd326 : 0xf4f5f2;
}
