export type Compound = 'SOFT' | 'MEDIUM' | 'HARD';
export type PaceMode = 'CONSERVE' | 'BALANCED' | 'PUSH';

export interface TireState {
  compound: Compound;
  wear: number;
  temperature: number;
  grip: number;
}

// Pitwall Racer is an eight-lap arcade strategy race. The compounds are
// intentionally exaggerated so the player can identify them from one corner:
// Soft is qualifying rubber, Medium is the reference, Hard is survival rubber.
const compound = {
  SOFT: { baseGrip: 1.34, wear: 3.35, ideal: 103 },
  MEDIUM: { baseGrip: 1.0, wear: 1.28, ideal: 97 },
  HARD: { baseGrip: 0.75, wear: 0.44, ideal: 90 },
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
 * Deliberately loud tyre model.
 *
 * Fresh Soft rubber gives absurdly obvious braking/turn-in advantage. The cost
 * is a short peak window. Once wear reaches roughly one third of the stint the
 * high-speed grip starts falling quickly, and after the halfway point it falls
 * off a cliff. That is intentional: this is a short game, not a tyre lab.
 */
export function stepTire(state: TireState, mode: PaceMode, load: number, dt: number): TireState {
  const spec = compound[state.compound];
  const map = pace[mode];
  const safeLoad = Math.max(0, Math.min(1.4, load));

  const targetTemp = spec.ideal + map.heat + safeLoad * 15 + state.wear * 6.5;
  const temperature = state.temperature
    + (targetTemp - state.temperature) * Math.min(1, dt * 0.32);
  const tempDelta = Math.abs(temperature - spec.ideal);
  const heatWear = 1 + Math.max(0, temperature - spec.ideal - 4) * 0.022;

  const wearRate = 0.00182
    * spec.wear
    * map.wear
    * (0.36 + safeLoad * 1.02)
    * heatWear;
  const wear = Math.min(1, state.wear + wearRate * dt);

  const baseWearLoss = wear * 0.075;
  const lateWear = Math.max(0, wear - 0.30);
  const cliff = Math.pow(lateWear, 1.08) * 2.28;
  const temperatureLoss = Math.max(0, tempDelta - 5) * 0.0058;
  const tempGrip = Math.max(0.72, 1 - temperatureLoss);
  const wearGrip = Math.max(0.30, 1 - baseWearLoss - cliff);
  const grip = Math.max(0.30, spec.baseGrip * map.grip * tempGrip * wearGrip);

  return { ...state, wear, temperature, grip };
}

export function compoundColor(name: Compound): number {
  return name === 'SOFT' ? 0xff4054 : name === 'MEDIUM' ? 0xffd326 : 0xf4f5f2;
}
