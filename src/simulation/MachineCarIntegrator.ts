import { controlArcadeCar, type ArcadeCarInput } from './ArcadeCarController';
import type { VehicleState } from './VehicleModel';

export const MACHINE_PHYSICS_DT = 1 / 120;
export const MACHINE_LINEAR_DAMPING = 0.018;
export const MACHINE_ANGULAR_DAMPING = 1.05;
export const MACHINE_MAX_YAW_RATE = 1.45;

/**
 * Full planar state used by the offline/reference optimiser.
 *
 * This deliberately retains vx/vy instead of collapsing the car to a scalar
 * speed. The old reference envelope repeatedly re-created a perfectly aligned
 * state for each local query, which erased transient lateral velocity and yaw.
 * A machine-optimal lap must be scored by carrying those states through every
 * 120 Hz step, just like the physical race car does.
 */
export interface MachineCarState {
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
  yawRate: number;
}

export function machineStateFromVehicle(vehicle: VehicleState): MachineCarState {
  return {
    x: vehicle.x,
    y: vehicle.y,
    heading: vehicle.heading,
    vx: Math.cos(vehicle.heading) * vehicle.speed,
    vy: Math.sin(vehicle.heading) * vehicle.speed,
    yawRate: vehicle.yawRate,
  };
}

export function machineStateSpeed(state: MachineCarState): number {
  return Math.hypot(state.vx, state.vy);
}

/**
 * Advance the same clean-air chassis used by RapierRacePhysics by one step.
 *
 * Contacts are intentionally absent: the machine reference is only valid while
 * it remains inside the legal track envelope. Barrier contact is therefore a
 * failed candidate, not a source of pace. The controller equations, linear and
 * angular damping, and spin cap match RapierRacePhysics.
 */
export function stepMachineCar(
  state: MachineCarState,
  input: ArcadeCarInput,
  dt = MACHINE_PHYSICS_DT,
): MachineCarState {
  const controlled = controlArcadeCar(
    {
      vx: state.vx,
      vy: state.vy,
      heading: state.heading,
      angularVelocity: state.yawRate,
    },
    input,
    dt,
  );

  const linearDamping = rapierDampingFactor(MACHINE_LINEAR_DAMPING, dt);
  const angularDamping = rapierDampingFactor(MACHINE_ANGULAR_DAMPING, dt);
  const vx = controlled.vx * linearDamping;
  const vy = controlled.vy * linearDamping;
  const yawRate = clamp(
    controlled.angularVelocity * angularDamping,
    -MACHINE_MAX_YAW_RATE,
    MACHINE_MAX_YAW_RATE,
  );

  // Rapier integrates the damped velocity over the configured world timestep.
  // Keeping this explicit makes the optimiser deterministic and cheap enough to
  // evaluate thousands of candidates without constructing collision worlds.
  return {
    x: state.x + vx * dt,
    y: state.y + vy * dt,
    heading: wrapAngle(state.heading + yawRate * dt),
    vx,
    vy,
    yawRate,
  };
}

export function rapierDampingFactor(damping: number, dt: number): number {
  return 1 / (1 + Math.max(0, damping) * Math.max(0, dt));
}

function wrapAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
