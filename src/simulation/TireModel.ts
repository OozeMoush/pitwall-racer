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
  SOFT: { baseGrip: 1.26, wear: 2.42, ideal: 103 },
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
 * Degradation removes braking and turning confidence first. Medium can be
 * nursed toward twelve laps, but the late stint still costs enough corner time
 * that a legal stop is attractive. Soft retains a short peak because its wear
 * multiplier is much higher even though the common base rate is calmer.
 */
export function stepTire(state: TireState, mode: PaceMode, load: number, dt: number): TireState {
  const spec = compound[state.compound];
  const map = pace[mode];
  const safeLoad = Math.max(0, Math.min(1.4, load));

  const targetTemp = spec.ideal + map.heat + safeLoad * 15 + state.wear * 5.5;
  const temperature = state.temperature
    + (targetTemp - state.temperature) * Math.min(1, dt * 0.30);
  const tempDelta = Math.abs(temperature - spec.ideal);
  const heatWear = 1 + Math.max(0, temperature - spec.ideal - 4) * 0.017;

  const wearRate = 0.00094
    * spec.wear
    * map.wear
    * (0.36 + safeLoad * 1.02)
    * heatWear;
  const wear = Math.min(1, state.wear + wearRate * dt);

  const baseWearLoss = wear * 0.045;
  const lateWear = Math.max(0, wear - 0.47);
  const cliff = Math.pow(lateWear, 1.20) * 1.58;
  const temperatureLoss = Math.max(0, tempDelta - 5) * 0.0048;
  const tempGrip = Math.max(0.80, 1 - temperatureLoss);
  const wearGrip = Math.max(0.45, 1 - baseWearLoss - cliff);
  const grip = Math.max(0.36, spec.baseGrip * map.grip * tempGrip * wearGrip);

  return { ...state, wear, temperature, grip };
}

export function compoundColor(name: Compound): number {
  return name === 'SOFT' ? 0xff4054 : name === 'MEDIUM' ? 0xffd326 : 0xf4f5f2;
}
