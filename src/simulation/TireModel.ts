export type Compound = 'SOFT' | 'MEDIUM' | 'HARD';
export type PaceMode = 'CONSERVE' | 'BALANCED' | 'PUSH';

export interface TireState {
  compound: Compound;
  wear: number;
  temperature: number;
  grip: number;
}

// Arcade-first on purpose: the player should identify a compound from one lap.
// Soft is a qualifying tyre, Hard is a survival tyre, Medium is the baseline.
const compound = {
  SOFT: { baseGrip: 1.20, wear: 2.55, ideal: 103 },
  MEDIUM: { baseGrip: 1.0, wear: 1.0, ideal: 97 },
  HARD: { baseGrip: 0.84, wear: 0.42, ideal: 90 },
} satisfies Record<Compound, { baseGrip: number; wear: number; ideal: number }>;

const pace = {
  CONSERVE: { wear: 0.64, heat: -2.2, grip: 0.985 },
  BALANCED: { wear: 1, heat: 0, grip: 1 },
  PUSH: { wear: 1.52, heat: 3.2, grip: 1.04 },
} satisfies Record<PaceMode, { wear: number; heat: number; grip: number }>;

export function createTire(compoundName: Compound): TireState {
  const spec = compound[compoundName];
  return {
    compound: compoundName,
    wear: 0,
    temperature: spec.ideal - 8,
    grip: spec.baseGrip * 0.965,
  };
}

/**
 * Short-race tyre model with a visible cliff. Fresh tyres are intentionally
 * generous at high speed; once wear reaches the second half of the stint the
 * grip loss accelerates hard so the same corner suddenly needs a lift/brake.
 */
export function stepTire(state: TireState, mode: PaceMode, load: number, dt: number): TireState {
  const spec = compound[state.compound];
  const map = pace[mode];
  const safeLoad = Math.max(0, Math.min(1.35, load));

  const targetTemp = spec.ideal + map.heat + safeLoad * 14.5 + state.wear * 5.5;
  const temperature = state.temperature
    + (targetTemp - state.temperature) * Math.min(1, dt * 0.3);
  const tempDelta = Math.abs(temperature - spec.ideal);
  const heatWear = 1 + Math.max(0, temperature - spec.ideal - 4) * 0.02;

  const wearRate = 0.00168
    * spec.wear
    * map.wear
    * (0.38 + safeLoad * 0.98)
    * heatWear;
  const wear = Math.min(1, state.wear + wearRate * dt);

  const baseWearLoss = wear * 0.10;
  const lateWear = Math.max(0, wear - 0.40);
  const cliff = Math.pow(lateWear, 1.18) * 1.9;
  const temperatureLoss = Math.max(0, tempDelta - 5) * 0.0055;
  const tempGrip = Math.max(0.74, 1 - temperatureLoss);
  const wearGrip = Math.max(0.40, 1 - baseWearLoss - cliff);
  const grip = Math.max(0.40, spec.baseGrip * map.grip * tempGrip * wearGrip);

  return { ...state, wear, temperature, grip };
}

export function compoundColor(name: Compound): number {
  return name === 'SOFT' ? 0xff4054 : name === 'MEDIUM' ? 0xffd326 : 0xf4f5f2;
}
