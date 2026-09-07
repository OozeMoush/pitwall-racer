export interface EnergyState {
  /** Battery state of charge, normalized 0..1. */
  soc: number;
  /** Normalized energy deployed during the latest step. */
  deployment: number;
  /** Normalized energy harvested during the latest step. */
  harvesting: number;
  /** Multiplicative power assistance exposed to the vehicle model. */
  powerBoost: number;
  overtakeActive: boolean;
}

export interface EnergyInputs {
  throttle: number;
  brake: number;
  speed: number;
  overtakeRequested: boolean;
}

export function createEnergy(soc = 0.68): EnergyState {
  return {
    soc: clamp01(soc),
    deployment: 0,
    harvesting: 0,
    powerBoost: 0,
    overtakeActive: false,
  };
}

/**
 * Game-facing hybrid energy model.
 *
 * It intentionally models the important trade rather than exact FIA electrical
 * limits: braking/lifting can recover charge, normal acceleration spends a
 * little, and OVERTAKE spends charge much faster for a larger power gain.
 */
export function stepEnergy(state: EnergyState, inputs: EnergyInputs, dt: number): EnergyState {
  const throttle = clamp01(inputs.throttle);
  const brake = clamp01(inputs.brake);
  const speedFactor = clamp01(inputs.speed / 42);

  const brakingHarvestRate = brake * speedFactor * 0.115;
  const liftHarvestRate = throttle < 0.05 && brake < 0.05 && inputs.speed > 25 ? 0.014 : 0;
  const harvestRate = brakingHarvestRate + liftHarvestRate;

  const wantsOvertake = inputs.overtakeRequested && throttle > 0.15 && state.soc > 0.012;
  const normalDeployRate = throttle * 0.025;
  const overtakeDeployRate = throttle * 0.118;
  const requestedDeployRate = wantsOvertake ? overtakeDeployRate : normalDeployRate;
  const maxAffordableRate = dt > 0 ? state.soc / dt : 0;
  const deployRate = Math.min(requestedDeployRate, maxAffordableRate);

  const soc = clamp01(state.soc + (harvestRate - deployRate) * dt);
  const deploymentFraction = overtakeDeployRate > 0 ? deployRate / 0.118 : 0;
  const powerBoost = wantsOvertake
    ? 0.12 * deploymentFraction
    : 0.025 * Math.min(1, deploymentFraction * (0.118 / 0.025));

  return {
    soc,
    deployment: deployRate,
    harvesting: harvestRate,
    powerBoost,
    overtakeActive: wantsOvertake && deployRate > normalDeployRate,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
