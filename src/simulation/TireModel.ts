export type Compound = 'SOFT' | 'MEDIUM' | 'HARD';
export type PaceMode = 'CONSERVE' | 'BALANCED' | 'PUSH';

export interface TireState {
  compound: Compound;
  wear: number;
  temperature: number;
  grip: number;
}

// Twelve-lap core races need readable compound differences without turning the
// tyres into engine maps. Soft attacks corners, Medium is the reference and
// Hard gives away corner speed in exchange for a genuinely long stint.
const compound = {
  SOFT: { baseGrip: 1.26, wear: 2.35, ideal: 103 },
  MEDIUM: { baseGrip: 1.0, wear: 1.0, ideal: 97 },
  HARD: { baseGrip: 0.82, wear: 0.48, ideal: 90 },
} satisfies Record<Compound, { baseGrip: number; wear: number; ideal: number }>;

const pace = {
  CONSERVE: { wear: 0.62, heat: -2.2, grip: 0.985 },
  BALANCED: { wear: 1, heat: 0, grip: 1 },
  PUSH: { wear: 1.58, heat: 3.4, grip: 1.045 },
} satisfies Record<PaceMode, { wear: number; heat: number; grip: number }>;

export function createTire(compoundName: Compound): TireState {
  const spec = compound[compoundName];
  return {
    compound: compoundName,
    wear: 0,
    temperature: spec.ideal - 5,
    grip: spec.baseGrip * 0.985,
  };
}

/**
 * Arcade tyre model for a longer race.
 *
 * Degradation removes braking and turning confidence first. A worn tyre can
 * still run down a straight, but it needs an earlier brake point and a slower
 * line through the next corner. The cliff is late enough to create a stint,
 * not an instant punishment.
 */
export function stepTire(state: TireState, mode: PaceMode, load: number, dt: number): TireState {
  const spec = compound[state.compound];
  const map = pace[mode];
  const safeLoad = Math.max(0, Math.min(1.4, load));

  const targetTemp = spec.ideal + map.heat + safeLoad * 15 + state.wear * 6;
  const temperature = state.temperature
    + (targetTemp - state.temperature) * Math.min(1, dt * 0.30);
  const tempDelta = Math.abs(temperature - spec.ideal);
  const heatWear = 1 + Math.max(0, temperature - spec.ideal - 4) * 0.019;

  const wearRate = 0.00132
    * spec.wear
    * map.wear
    * (0.36 + safeLoad * 1.02)
    * heatWear;
  const wear = Math.min(1, state.wear + wearRate * dt);

  const baseWearLoss = wear * 0.055;
  const lateWear = Math.max(0, wear - 0.40);
  const cliff = Math.pow(lateWear, 1.18) * 1.92;
  const temperatureLoss = Math.max(0, tempDelta - 5) * 0.0053;
  const tempGrip = Math.max(0.76, 1 - temperatureLoss);
  const wearGrip = Math.max(0.40, 1 - baseWearLoss - cliff);
  const grip = Math.max(0.34, spec.baseGrip * map.grip * tempGrip * wearGrip);

  return { ...state, wear, temperature, grip };
}

export function compoundColor(name: Compound): number {
  return name === 'SOFT' ? 0xff4054 : name === 'MEDIUM' ? 0xffd326 : 0xf4f5f2;
}
