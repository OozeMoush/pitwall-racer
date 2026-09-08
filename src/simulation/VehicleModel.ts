import type { TireState } from './TireModel';

export interface Controls { throttle: number; brake: number; steer: number }
export interface VehicleState { x: number; y: number; heading: number; speed: number; yawRate: number }
export interface AeroModifiers { tow?: number; dirtyAir?: number; powerBoost?: number }

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
  const dirtyAir = Math.max(0, Math.min(0.35, aero.dirtyAir ?? 0));
  const tow = Math.max(0, Math.min(0.2, aero.tow ?? 0));
  const powerBoost = Math.max(0, Math.min(0.15, aero.powerBoost ?? 0));

  // Wear is deliberately felt through the controls, not just through a HUD number.
  // A tired tyre turns in less eagerly and asks for a slightly longer braking zone.
  const lateWear = Math.max(0, (tire.wear - 0.45) / 0.55);
  const steeringConfidence = 1 - lateWear * 0.24;
  const brakingConfidence = 1 - lateWear * 0.18;
  const cornerGrip = tire.grip * (1 - dirtyAir) * steeringConfidence;

  const drag = 0.00034 * v.speed * v.speed * (1 - tow * 0.7);
  const engine = c.throttle * 92 * Math.max(0.28, 1 - v.speed / 112) * (1 + tow * 0.35 + powerBoost);
  const braking = c.brake * 132 * brakingConfidence;
  const acceleration = engine - braking - drag - 1.1;
  const speed = Math.max(0, Math.min(112, v.speed + acceleration * dt));
  const speedFactor = Math.min(1, speed / 34);

  const highSpeedWearPush = lateWear * Math.min(1, speed / 80) * 0.08;
  const desiredYaw = c.steer
    * (1.7 - Math.min(speed, 90) * 0.008 - highSpeedWearPush)
    * cornerGrip
    * speedFactor;
  const response = 8 * (1 - lateWear * 0.18);
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
