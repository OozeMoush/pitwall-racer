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

export function createEnergy(soc = 0.72): EnergyState {
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
 * This is deliberately not a FIA electrical simulation. It exists to create a
 * readable race-game trade: charged battery = useful straight-line assistance;
 * OVERTAKE = a much bigger short burst; braking = the main way to earn it back.
 * Running the battery flat now has a visible pace cost instead of leaving the
 * car effectively unchanged.
 */
export function stepEnergy(state: EnergyState, inputs: EnergyInputs, dt: number): EnergyState {
  const throttle = clamp01(inputs.throttle);
  const brake = clamp01(inputs.brake);
  const speedFactor = clamp01(inputs.speed / 58);

  const brakingHarvestRate = brake * speedFactor * 0.068;
  const liftHarvestRate = throttle < 0.05 && brake < 0.05 && inputs.speed > 35 ? 0.006 : 0;
  const harvestRate = brakingHarvestRate + liftHarvestRate;

  const canDeploy = state.soc > 0.012 && throttle > 0.12;
  const wantsOvertake = inputs.overtakeRequested && state.soc > 0.055 && throttle > 0.2;
  const normalDeployRate = canDeploy ? throttle * 0.012 : 0;
  const overtakeDeployRate = throttle * 0.095;
  const requestedDeployRate = wantsOvertake ? overtakeDeployRate : normalDeployRate;
  const maxAffordableRate = dt > 0 ? state.soc / dt : 0;
  const deployRate = Math.min(requestedDeployRate, maxAffordableRate);

  const soc = clamp01(state.soc + (harvestRate - deployRate) * dt);
  const normalFraction = normalDeployRate > 0 ? Math.min(1, deployRate / normalDeployRate) : 0;
  const overtakeFraction = wantsOvertake ? Math.min(1, deployRate / overtakeDeployRate) : 0;
  const powerBoost = wantsOvertake
    ? 0.24 * overtakeFraction
    : canDeploy
      ? 0.10 * normalFraction
      : 0;

  return {
    soc,
    deployment: deployRate,
    harvesting: harvestRate,
    powerBoost,
    overtakeActive: wantsOvertake && overtakeFraction > 0.25,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
