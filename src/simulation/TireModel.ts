export type Compound = 'SOFT' | 'MEDIUM' | 'HARD';
export type PaceMode = 'CONSERVE' | 'BALANCED' | 'PUSH';

export interface TireState {
  compound: Compound;
  wear: number;
  temperature: number;
  grip: number;
}

// Pitwall Racer is an eight-lap arcade strategy race, not a tyre laboratory.
// The compounds therefore need to be readable from one lap and one corner:
// Soft buys obvious lap time, Hard visibly gives it away, and the price is life.
const compound = {
  SOFT: { baseGrip: 1.13, wear: 2.05, ideal: 103 },
  MEDIUM: { baseGrip: 1.0, wear: 1.0, ideal: 97 },
  HARD: { baseGrip: 0.91, wear: 0.52, ideal: 90 },
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
    temperature: spec.ideal - 9,
    grip: spec.baseGrip * 0.95,
  };
}

/**
 * Deliberately game-facing tyre model.
 *
 * A fresh Soft should immediately feel like a qualifying tyre. A Hard should
 * immediately require earlier braking and patience on rotation. Age then pushes
 * every compound in the same direction: longer braking, wider radius and weaker
 * corner exit. The cliff is intentionally visible because a race is only 8 laps.
 */
export function stepTire(state: TireState, mode: PaceMode, load: number, dt: number): TireState {
  const spec = compound[state.compound];
  const map = pace[mode];
  const safeLoad = Math.max(0, Math.min(1.35, load));

  const targetTemp = spec.ideal + map.heat + safeLoad * 14.5 + state.wear * 4.5;
  const temperature = state.temperature
    + (targetTemp - state.temperature) * Math.min(1, dt * 0.27);
  const tempDelta = Math.abs(temperature - spec.ideal);
  const heatWear = 1 + Math.max(0, temperature - spec.ideal - 5) * 0.017;

  const wearRate = 0.00162
    * spec.wear
    * map.wear
    * (0.40 + safeLoad * 0.94)
    * heatWear;
  const wear = Math.min(1, state.wear + wearRate * dt);

  const baseWearLoss = wear * 0.12;
  const lateWear = Math.max(0, wear - 0.52);
  const cliff = Math.pow(lateWear, 1.32) * 1.42;
  const temperatureLoss = Math.max(0, tempDelta - 5) * 0.0055;
  const tempGrip = Math.max(0.75, 1 - temperatureLoss);
  const wearGrip = Math.max(0.52, 1 - baseWearLoss - cliff);
  const grip = Math.max(0.48, spec.baseGrip * map.grip * tempGrip * wearGrip);

  return { ...state, wear, temperature, grip };
}

export function compoundColor(name: Compound): number {
  return name === 'SOFT' ? 0xff4054 : name === 'MEDIUM' ? 0xffd326 : 0xf4f5f2;
}
