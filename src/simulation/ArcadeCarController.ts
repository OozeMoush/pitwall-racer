export interface PlanarMotion {
  vx: number;
  vy: number;
  heading: number;
  angularVelocity: number;
}

export interface ArcadeCarInput {
  throttle: number;
  brake: number;
  steer: number;
  tireGrip: number;
  surfaceGrip?: number;
  powerBoost?: number;
  powerMultiplier?: number;
  rollingResistance?: number;
}

export interface ArcadeCarControlResult {
  vx: number;
  vy: number;
  angularVelocity: number;
  speed: number;
  forwardSpeed: number;
  lateralSpeed: number;
  acceleration: number;
}

/**
 * Arcade race-car controller used on top of a real rigid-body solver.
 * Rapier owns integration/contact; this describes engine, brake and tyre intent.
 */
export function controlArcadeCar(
  motion: PlanarMotion,
  input: ArcadeCarInput,
  dt: number,
): ArcadeCarControlResult {
  const throttle = clamp01(input.throttle);
  const brake = clamp01(input.brake);
  const steer = clamp(input.steer, -1, 1);
  const tireGrip = clamp(input.tireGrip, 0.5, 1.15);
  const surfaceGrip = clamp(input.surfaceGrip ?? 1, 0.45, 1.05);
  const powerBoost = clamp(input.powerBoost ?? 0, -0.25, 0.4);
  const powerMultiplier = clamp(input.powerMultiplier ?? 1, 0.3, 1.1);
  const rollingResistance = clamp(input.rollingResistance ?? 0, 0, 14);

  const cos = Math.cos(motion.heading);
  const sin = Math.sin(motion.heading);
  const rightX = -sin;
  const rightY = cos;

  const forwardSpeed = motion.vx * cos + motion.vy * sin;
  const lateralSpeed = motion.vx * rightX + motion.vy * rightY;
  const speed = Math.hypot(motion.vx, motion.vy);

  // A proper long-straight envelope: NORMAL can reach the mid-300s km/h,
  // DEPLOY can clearly pull beyond it, and HARVEST gives that speed away.
  // Acceleration still tapers over several seconds instead of teleporting to cap.
  const usefulTopSpeed = 110 + powerBoost * 60;
  const positiveForward = Math.max(0, forwardSpeed);
  const speedRatio = clamp01(positiveForward / Math.max(60, usefulTopSpeed));
  const powerTaper = Math.max(0, 1 - Math.pow(speedRatio, 1.85));
  const engineAcceleration = throttle
    * 13.8
    * powerTaper
    * (1 + powerBoost * 0.58)
    * powerMultiplier;

  const aeroDrag = 0.00025 * speed * speed;
  const rollingDrag = 0.55 + rollingResistance;
  const brakingAcceleration = brake * 29 * (0.82 + tireGrip * 0.18) * surfaceGrip;

  let longitudinalAcceleration = engineAcceleration - aeroDrag - rollingDrag;
  if (Math.abs(forwardSpeed) > 0.15) {
    longitudinalAcceleration -= Math.sign(forwardSpeed) * brakingAcceleration;
  } else if (brake > 0.05) {
    longitudinalAcceleration = Math.min(0, longitudinalAcceleration);
  }

  let nextForward = forwardSpeed + longitudinalAcceleration * dt;
  if (brake > 0 && forwardSpeed > 0 && nextForward < 0) nextForward = 0;
  if (throttle >= 0 && nextForward < -3) nextForward = -3;

  const highSpeedSlip = clamp01(speed / 120);
  const lateralGripRate = 8.1 * tireGrip * surfaceGrip * (1 - highSpeedSlip * 0.34);
  const lateralRetention = Math.exp(-lateralGripRate * Math.max(0, dt));
  const nextLateral = lateralSpeed * lateralRetention;

  // High speed now demands an actual braking decision. Above ~300 km/h, holding
  // A/D produces a very large radius rather than a magic full-speed corner.
  const speedAuthority = 1.75 / (1 + Math.pow(speed / 32, 2.1)) + 0.02;
  const lowSpeedBuild = clamp01(speed / 13);
  const brakingRotation = 1 + brake * 0.22;
  const targetAngularVelocity = steer
    * speedAuthority
    * lowSpeedBuild
    * tireGrip
    * surfaceGrip
    * brakingRotation;
  const angularResponse = 1 - Math.exp(-Math.max(0, dt) * (4.0 + (1 - highSpeedSlip) * 2.3));
  const nextAngularVelocity = motion.angularVelocity
    + (targetAngularVelocity - motion.angularVelocity) * angularResponse;

  return {
    vx: cos * nextForward + rightX * nextLateral,
    vy: sin * nextForward + rightY * nextLateral,
    angularVelocity: nextAngularVelocity,
    speed,
    forwardSpeed,
    lateralSpeed,
    acceleration: longitudinalAcceleration,
  };
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
