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
 * Arcade race-car controller used on top of Rapier.
 *
 * Grip is intentionally obvious rather than subtle. A Soft should let the
 * player brake later, rotate harder and apply throttle earlier. A worn Medium
 * or a fresh Hard should force a different driving rhythm on the same corner.
 */
export function controlArcadeCar(
  motion: PlanarMotion,
  input: ArcadeCarInput,
  dt: number,
): ArcadeCarControlResult {
  const throttle = clamp01(input.throttle);
  const brake = clamp01(input.brake);
  const steer = clamp(input.steer, -1, 1);
  const tireGrip = clamp(input.tireGrip, 0.46, 1.18);
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
  const normalizedGrip = clamp01((tireGrip - 0.46) / 0.66);

  const usefulTopSpeed = 110 + powerBoost * 60;
  const positiveForward = Math.max(0, forwardSpeed);
  const speedRatio = clamp01(positiveForward / Math.max(60, usefulTopSpeed));
  const powerTaper = Math.max(0, 1 - Math.pow(speedRatio, 1.85));

  const steeringLoad = Math.abs(steer) * clamp01(speed / 78);
  const tractionGrip = 0.52 + normalizedGrip * 0.48;
  const combinedTraction = 1 - steeringLoad * throttle * (0.16 + (1 - normalizedGrip) * 0.43);
  const engineAcceleration = throttle
    * 13.8
    * powerTaper
    * (1 + powerBoost * 0.58)
    * powerMultiplier
    * tractionGrip
    * Math.max(0.42, combinedTraction);

  const aeroDrag = 0.00025 * speed * speed;
  const rollingDrag = 0.55 + rollingResistance;
  const brakingGrip = (0.31 + normalizedGrip * 0.79) * surfaceGrip;
  const brakingAcceleration = brake * 29.5 * brakingGrip;

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
  const tyreLateralAuthority = Math.pow(Math.max(0.43, tireGrip), 1.9);
  const lateralGripRate = 8.5
    * tyreLateralAuthority
    * surfaceGrip
    * (1 - highSpeedSlip * 0.38);
  const lateralRetention = Math.exp(-lateralGripRate * Math.max(0, dt));
  const nextLateral = lateralSpeed * lateralRetention;

  const speedAuthority = 1.75 / (1 + Math.pow(speed / 32, 2.1)) + 0.02;
  const lowSpeedBuild = clamp01(speed / 13);
  const fastCorner = clamp01((speed - 34) / 62);
  const throttleUndersteer = 1 - throttle * Math.abs(steer) * fastCorner * 0.54;
  const liftRotation = throttle < 0.12 && brake < 0.08 ? 1.12 : 1;
  const brakingRotation = 1 + brake * (0.37 + fastCorner * 0.16);
  const wornSteering = Math.pow(Math.max(0.44, tireGrip), 1.85);
  const targetAngularVelocity = steer
    * speedAuthority
    * lowSpeedBuild
    * wornSteering
    * surfaceGrip
    * Math.max(0.42, throttleUndersteer)
    * liftRotation
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
