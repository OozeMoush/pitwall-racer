import type { TireState } from './TireModel';

export interface Controls { throttle: number; brake: number; steer: number }
export interface VehicleState { x: number; y: number; heading: number; speed: number; yawRate: number }
export interface AeroModifiers {
  tow?: number;
  dirtyAir?: number;
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
  const powerBoost = clamp(aero.powerBoost ?? 0, 0, 0.3);
  const surfaceGrip = clamp(aero.surfaceGrip ?? 1, 0.5, 1);
  const powerMultiplier = clamp(aero.powerMultiplier ?? 1, 0.35, 1);
  const rollingResistance = clamp(aero.rollingResistance ?? 0, 0, 14);

  const lateWear = Math.max(0, (tire.wear - 0.45) / 0.55);
  const steeringConfidence = 1 - lateWear * 0.28;
  const brakingConfidence = 1 - lateWear * 0.2;
  const cornerGrip = tire.grip * (1 - dirtyAir) * steeringConfidence * surfaceGrip;

  const drag = 0.00038 * v.speed * v.speed * (1 - tow * 0.72);
  const powerTaper = Math.max(0.12, 1 - v.speed / 118);
  const engine = c.throttle
    * 108
    * powerTaper
    * (1 + tow * 0.32 + powerBoost)
    * powerMultiplier;
  const braking = c.brake * 145 * brakingConfidence;
  const acceleration = engine - braking - drag - 1.15 - rollingResistance;

  // Stored electrical energy changes the useful end of the speed envelope.
  // With no battery assistance the car is still drivable, but it loses enough
  // straight-line performance that harvesting and timed OVERTAKE deployment
  // matter against a competitive AI field.
  const speedLimit = clamp(92 + powerBoost * 70 + tow * 30, 86, 112);
  const speed = Math.max(0, Math.min(speedLimit, v.speed + acceleration * dt));
  const speedFactor = Math.min(1, speed / 32);

  // High speed must create a braking decision. The old linear steering formula
  // still allowed nearly full cornering authority above 300 km/h, making every
  // bend effectively flat. This curve deliberately makes radius grow quickly
  // with speed while keeping low-speed hairpins responsive on a keyboard.
  const highSpeedAuthority = 1.95 / (1 + Math.pow(speed / 58, 1.8));
  const trailBrakeRotation = c.brake * Math.min(0.12, speed / 700);
  const desiredYaw = c.steer
    * (highSpeedAuthority + trailBrakeRotation)
    * cornerGrip
    * speedFactor;
  const response = 8.5 * (1 - lateWear * 0.2);
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
