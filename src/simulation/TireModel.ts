export type Compound = 'SOFT' | 'MEDIUM' | 'HARD';
export type PaceMode = 'CONSERVE' | 'BALANCED' | 'PUSH';

export interface TireState {
  compound: Compound;
  wear: number;
  temperature: number;
  grip: number;
}

// Keep the compounds close enough that all three can be strategic choices.
// Soft wins on cornering but pays for it in stint length. Medium is the race
// reference. Hard gives away only a modest amount of fresh corner speed, then
// earns that loss back through long-run stability and life.
const compound = {
  SOFT: { baseGrip: 1.16, wear: 2.20, ideal: 103 },
  MEDIUM: { baseGrip: 1.05, wear: 1.00, ideal: 97 },
  HARD: { baseGrip: 1.025, wear: 0.50, ideal: 90 },
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

/** Medium's nominal peak is the 100% reference used by UI/strategy tools. */
export function gripRatioToMedium(grip: number): number {
  return grip / compound.MEDIUM.baseGrip;
}

export function gripPercent(grip: number): number {
  return gripRatioToMedium(grip) * 100;
}

/**
 * Arcade tyre model for a longer race.
 *
 * Tyre age should not mainly feel like the steering rack disappearing. Peak
 * cornering grip still fades, but more gently than before; the car controller
 * uses the resulting effective grip separately to make an over-driven old tyre
 * slide and bleed speed. That keeps the feedback simple: an old tyre can still
 * turn, but asking too much from it costs lap time.
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

  // Keep enough steering authority on an old tyre to make the degradation
  // playable. The larger late-stint cost now comes from slide/speed loss in the
  // controller rather than an extreme loss of nominal grip.
  const baseWearLoss = wear * 0.030;
  const lateWear = Math.max(0, wear - 0.56);
  const cliff = Math.pow(lateWear, 1.20) * 0.96;
  const temperatureLoss = Math.max(0, tempDelta - 5) * 0.0048;
  const tempGrip = Math.max(0.80, 1 - temperatureLoss);
  const wearGrip = Math.max(0.58, 1 - baseWearLoss - cliff);
  const grip = Math.max(0.44, spec.baseGrip * map.grip * tempGrip * wearGrip);

  return { ...state, wear, temperature, grip };
}

export function compoundColor(name: Compound): number {
  return name === 'SOFT' ? 0xff4054 : name === 'MEDIUM' ? 0xffd326 : 0xf4f5f2;
}
