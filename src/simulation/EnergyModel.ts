export type EnergyMode = 'HARVEST' | 'NORMAL' | 'DEPLOY';

export interface EnergyState {
  /** Battery state of charge, normalized 0..1. */
  soc: number;
  /** Normalized energy deployed during the latest step. */
  deployment: number;
  /** Normalized energy harvested during the latest step. */
  harvesting: number;
  /** Signed power assistance exposed to the vehicle model. */
  powerBoost: number;
  mode: EnergyMode;
}

export interface EnergyInputs {
  throttle: number;
  brake: number;
  speed: number;
  mode: EnergyMode;
}

export function createEnergy(soc = 0.72, mode: EnergyMode = 'NORMAL'): EnergyState {
  return {
    soc: clamp01(soc),
    deployment: 0,
    harvesting: 0,
    powerBoost: mode === 'HARVEST' ? -0.42 : mode === 'DEPLOY' ? 0.38 : 0.075,
    mode,
  };
}

/**
 * Deliberately arcade-facing hybrid system.
 *
 * HARVEST is a real sacrifice: it charges with W held but gives away enough
 * pace that it is for recovery zones, not a permanent race mode. NORMAL is the
 * sustainable baseline. DEPLOY is a short attack button with an unmistakable
 * speed advantage and an equally obvious battery cost.
 */
export function stepEnergy(state: EnergyState, inputs: EnergyInputs, dt: number): EnergyState {
  const throttle = clamp01(inputs.throttle);
  const brake = clamp01(inputs.brake);
  const speedFactor = clamp01(inputs.speed / 70);
  const mode = inputs.mode;

  const brakingHarvestRate = brake * (0.045 + speedFactor * 0.07);
  const liftHarvestRate = throttle < 0.05 && brake < 0.05 && inputs.speed > 30 ? 0.01 : 0;
  const throttleHarvestRate = mode === 'HARVEST'
    ? throttle * (0.028 + speedFactor * 0.022)
    : 0;
  const harvestRate = brakingHarvestRate + liftHarvestRate + throttleHarvestRate;

  let requestedDeployRate = 0;
  if (mode === 'NORMAL' && throttle > 0.1 && state.soc > 0.04) requestedDeployRate = throttle * 0.0045;
  if (mode === 'DEPLOY' && throttle > 0.1 && state.soc > 0.012) requestedDeployRate = throttle * 0.09;

  const maxAffordableRate = dt > 0 ? state.soc / dt : 0;
  const deployRate = Math.min(requestedDeployRate, maxAffordableRate);
  const soc = clamp01(state.soc + (harvestRate - deployRate) * dt);

  let powerBoost = 0;
  if (mode === 'HARVEST') {
    powerBoost = -0.42;
  } else if (mode === 'NORMAL') {
    powerBoost = state.soc > 0.02 ? 0.075 : 0;
  } else if (mode === 'DEPLOY') {
    const deployFraction = requestedDeployRate > 0 ? Math.min(1, deployRate / requestedDeployRate) : 0;
    powerBoost = 0.38 * deployFraction;
  }

  return {
    soc,
    deployment: deployRate,
    harvesting: harvestRate,
    powerBoost,
    mode,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
