export type Compound = 'SOFT' | 'MEDIUM' | 'HARD';
export type PaceMode = 'CONSERVE' | 'BALANCED' | 'PUSH';

export interface TireState {
  compound: Compound;
  wear: number;
  temperature: number;
  grip: number;
}

const compound = {
  SOFT: { baseGrip: 1.06, wear: 1.48, ideal: 101 },
  MEDIUM: { baseGrip: 1.0, wear: 1.0, ideal: 96 },
  HARD: { baseGrip: 0.955, wear: 0.68, ideal: 91 },
} satisfies Record<Compound, { baseGrip: number; wear: number; ideal: number }>;

const pace = {
  CONSERVE: { wear: 0.62, heat: -1.8, grip: 0.97 },
  BALANCED: { wear: 1, heat: 0, grip: 1 },
  PUSH: { wear: 1.5, heat: 3.2, grip: 1.03 },
} satisfies Record<PaceMode, { wear: number; heat: number; grip: number }>;

export function createTire(compoundName: Compound): TireState {
  const spec = compound[compoundName];
  return { compound: compoundName, wear: 0, temperature: spec.ideal - 8, grip: spec.baseGrip * 0.96 };
}

export function stepTire(state: TireState, mode: PaceMode, load: number, dt: number): TireState {
  const spec = compound[state.compound];
  const map = pace[mode];
  const targetTemp = spec.ideal + map.heat + load * 7;
  const temperature = state.temperature + (targetTemp - state.temperature) * Math.min(1, dt * 0.55);
  const heatPenalty = Math.max(0, Math.abs(temperature - spec.ideal) - 5) * 0.0035;

  // Calibrated for the enlarged ~minute-long lap: a balanced Medium should be
  // a plausible 4-5 lap first stint, Soft should reward aggression but punish
  // staying out too long, and Hard should trade immediate pace for flexibility.
  const wearRate = 0.00165 * spec.wear * map.wear * (0.55 + load * 0.75) * (1 + heatPenalty * 4);
  const wear = Math.min(1, state.wear + wearRate * dt);
  const cliff = wear > 0.72 ? (wear - 0.72) * 1.65 : 0;
  const tempGrip = Math.max(0.82, 1 - Math.abs(temperature - spec.ideal) * 0.0045);
  const grip = Math.max(0.54, spec.baseGrip * map.grip * tempGrip * (1 - wear * 0.19 - cliff));
  return { ...state, wear, temperature, grip };
}

export function compoundColor(name: Compound): number {
  return name === 'SOFT' ? 0xff4054 : name === 'MEDIUM' ? 0xffd326 : 0xf4f5f2;
}
