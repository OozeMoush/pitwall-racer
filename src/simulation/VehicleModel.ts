import type { TireState } from './TireModel';

export interface Controls { throttle: number; brake: number; steer: number }
export interface VehicleState { x: number; y: number; heading: number; speed: number; yawRate: number }
export interface AeroModifiers {
  tow?: number;
  dirtyAir?: number;
  /** Signed hybrid contribution. HARVEST may be negative; DEPLOY is strongly positive. */
  powerBoost?: number;
  surfaceGrip?: number;
  powerMultiplier?: number;
  rollingResistance?: number;
}

export function createVehicle(x: number, y: number, heading = 0): VehicleState {
  return { x, y, heading, speed: 0, yawRate: 0 };
}

export function stepVehicle(
  v: VehicleState,
  c: Controls,
  tire: TireState,
  dt: number,
  aero: AeroModifiers = {},
): VehicleState {
  const dirtyAir = clamp(aero.dirtyAir ?? 0, 0, 0.35);
  const tow = clamp(aero.tow ?? 0, 0, 0.2);
  const powerBoost = clamp(aero.powerBoost ?? 0, -0.2, 0.35);
  const surfaceGrip = clamp(aero.surfaceGrip ?? 1, 0.5, 1);
  const powerMultiplier = clamp(aero.powerMultiplier ?? 1, 0.35, 1);
  const rollingResistance = clamp(aero.rollingResistance ?? 0, 0, 14);

  const lateWear = Math.max(0, (tire.wear - 0.45) / 0.55);
  const steeringConfidence = 1 - lateWear * 0.3;
  const brakingConfidence = 1 - lateWear * 0.22;
  const cornerGrip = tire.grip * (1 - dirtyAir) * steeringConfidence * surfaceGrip;

  const drag = 0.0004 * v.speed * v.speed * (1 - tow * 0.72);
  const powerTaper = Math.max(0.1, 1 - v.speed / 119);
  const engine = c.throttle
    * 112
    * powerTaper
    * (1 + tow * 0.3 + Math.max(-0.16, powerBoost))
    * powerMultiplier;
  const braking = c.brake * 158 * brakingConfidence;
  const acceleration = engine - braking - drag - 1.15 - rollingResistance;

  // Hybrid mode changes the actual usable speed envelope, not only the first
  // metres of acceleration. HARVEST is intentionally slow; an empty NORMAL car
  // is beatable by the field; DEPLOY gives an obvious attack window.
  const speedLimit = clamp(92 + powerBoost * 70 + tow * 24, 78, 116);
  const speed = Math.max(0, Math.min(speedLimit, v.speed + acceleration * dt));
  const speedFactor = Math.min(1, speed / 30);

  // The car must stop being a 350 km/h slot car. High-speed steering authority
  // collapses aggressively, full throttle adds understeer, and braking/lifting
  // gives some rotation back. This creates an actual brake-point decision while
  // keeping hairpins playable with digital keyboard steering.
  const highSpeedAuthority = 1.82 / (1 + Math.pow(speed / 44, 2.25));
  const highSpeed = clamp((speed - 48) / 62, 0, 1);
  const throttleUndersteer = 1 - c.throttle * highSpeed * 0.24;
  const trailBrakeRotation = c.brake * (0.06 + highSpeed * 0.16);
  const desiredYaw = c.steer
    * (highSpeedAuthority * throttleUndersteer + trailBrakeRotation)
    * cornerGrip
    * speedFactor;
  const response = 8.2 * (1 - lateWear * 0.22);
  const yawRate = v.yawRate + (desiredYaw - v.yawRate) * Math.min(1, dt * response);
  const heading = v.heading + yawRate * dt;

  return {
    x: v.x + Math.cos(heading) * speed * dt,
    y: v.y + Math.sin(heading) * speed * dt,
    heading,
    speed,
    yawRate,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
