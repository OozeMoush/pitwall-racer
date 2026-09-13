import type { Compound, TireState } from './TireModel';

export type TyreCondition = 'OPTIMAL' | 'USED' | 'CLIFF RISK';
export type SlideRisk = 'LOW' | 'MED' | 'HIGH' | 'CRITICAL';

export interface TyreRaceStatus {
  condition: TyreCondition;
  slideRisk: SlideRisk;
  estimatedPaceLoss: number;
  lapsToCliff?: number;
}

// Miniature laps are much shorter, so the physical time-based wear accumulated
// per lap is lower. These values are strategy estimates only; TireModel remains
// authoritative for actual grip and wear.
const WEAR_PER_LAP: Record<Compound, number> = {
  SOFT: 0.050,
  MEDIUM: 0.026,
  HARD: 0.014,
};

const CLIFF_WEAR = 0.56;

/**
 * Strategy-facing interpretation of the physical tyre state. This does not
 * change physics; it translates wear into the information a driver would use
 * to decide whether to extend or pit.
 */
export function tyreRaceStatus(tire: TireState): TyreRaceStatus {
  const wear = Math.max(0, Math.min(1, tire.wear));
  const lateWear = Math.max(0, wear - 0.42);
  const estimatedPaceLoss = wear * 0.12 + Math.pow(lateWear, 1.18) * 1.8;

  const condition: TyreCondition = wear < 0.34
    ? 'OPTIMAL'
    : wear < 0.58
      ? 'USED'
      : 'CLIFF RISK';

  const slideRisk: SlideRisk = wear < 0.24
    ? 'LOW'
    : wear < 0.44
      ? 'MED'
      : wear < 0.67
        ? 'HIGH'
        : 'CRITICAL';

  const nominalWear = WEAR_PER_LAP[tire.compound];
  const lapsToCliff = wear >= CLIFF_WEAR
    ? 0
    : Math.max(0, Math.ceil((CLIFF_WEAR - wear) / nominalWear));

  return {
    condition,
    slideRisk,
    estimatedPaceLoss,
    lapsToCliff,
  };
}

export function formatTyreRaceStatus(status: TyreRaceStatus): string {
  const pace = status.estimatedPaceLoss < 0.03
    ? 'PACE ±0.0s'
    : `PACE -${status.estimatedPaceLoss.toFixed(1)}s/LAP`;
  const cliff = status.lapsToCliff === undefined
    ? ''
    : status.lapsToCliff <= 0
      ? ' · CLIFF NOW'
      : ` · CLIFF ~${status.lapsToCliff}L`;
  return `${status.condition} · ${pace} · SLIDE ${status.slideRisk}${cliff}`;
}
