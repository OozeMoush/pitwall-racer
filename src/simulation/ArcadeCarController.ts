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
 * Generous arcade handling on fresh rubber, then a deliberately dramatic tyre
 * cliff. At 250-300 km/h a fresh Soft can be thrown into a bend; the same input
 * on a worn Medium should suddenly run wide. That contrast is the strategy game.
 */
export function controlArcadeCar(
  motion: PlanarMotion,
  input: ArcadeCarInput,
  dt: number,
): ArcadeCarControlResult {
  const throttle = clamp01(input.throttle);
  const brake = clamp01(input.brake);
  const steer = clamp(input.steer, -1, 1);
  const tireGrip = clamp(input.tireGrip, 0.40, 1.24);
  const surfaceGrip = clamp(input.surfaceGrip ?? 1, 0.42, 1.05);
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
  const normalizedGrip = clamp01((tireGrip - 0.40) / 0.80);

  const usefulTopSpeed = 110 + powerBoost * 60;
  const positiveForward = Math.max(0, forwardSpeed);
  const speedRatio = clamp01(positiveForward / Math.max(60, usefulTopSpeed));
  const powerTaper = Math.max(0, 1 - Math.pow(speedRatio, 1.85));

  const steeringLoad = Math.abs(steer) * clamp01(speed / 82);
  const straightTraction = 0.93 + normalizedGrip * 0.07;
  const combinedTraction = 1 - steeringLoad * throttle * (0.12 + (1 - normalizedGrip) * 0.52);
  const engineAcceleration = throttle
    * 13.8
    * powerTaper
    * (1 + powerBoost * 0.58)
    * powerMultiplier
    * straightTraction
    * Math.max(0.38, combinedTraction);

  const aeroDrag = 0.00025 * speed * speed;
  const rollingDrag = 0.55 + rollingResistance;
  const brakingGrip = (0.28 + normalizedGrip * 0.90) * surfaceGrip;
  const brakingAcceleration = brake * 30.5 * brakingGrip;

  let longitudinalAcceleration = engineAcceleration - aeroDrag - rollingDrag;
  if (Math.abs(forwardSpeed) > 0.15) {
    longitudinalAcceleration -= Math.sign(forwardSpeed) * brakingAcceleration;
  } else if (brake > 0.05) {
    longitudinalAcceleration = Math.min(0, longitudinalAcceleration);
  }

  let nextForward = forwardSpeed + longitudinalAcceleration * dt;
  if (brake > 0 && forwardSpeed > 0 && nextForward < 0) nextForward = 0;
  if (throttle >= 0 && nextForward < -3) nextForward = -3;

  const highSpeedSlip = clamp01(speed / 125);
  const tyreLateralAuthority = 0.42 + Math.pow(normalizedGrip, 1.75) * 1.18;
  const lateralGripRate = 8.9
    * tyreLateralAuthority
    * surfaceGrip
    * (1 - highSpeedSlip * 0.28);
  const lateralRetention = Math.exp(-lateralGripRate * Math.max(0, dt));
  const nextLateral = lateralSpeed * lateralRetention;

  // More steering authority than before at high speed, but the authority is now
  // carried by tyre grip. This makes the first laps deliberately forgiving and
  // the worn-tyre drop unmistakable instead of making every tyre equally numb.
  const speedAuthority = 2.18 / (1 + Math.pow(speed / 42, 1.72)) + 0.045;
  const lowSpeedBuild = clamp01(speed / 12);
  const fastCorner = clamp01((speed - 38) / 58);
  const freshHighSpeedAuthority = 0.20 + Math.pow(normalizedGrip, 1.65) * 1.12;
  const tyreTurnFactor = (1 - fastCorner) * (0.70 + normalizedGrip * 0.42)
    + fastCorner * freshHighSpeedAuthority;
  const throttleUndersteer = 1 - throttle * Math.abs(steer) * fastCorner * (0.18 + (1 - normalizedGrip) * 0.58);
  const liftRotation = throttle < 0.12 && brake < 0.08 ? 1.1 : 1;
  const brakingRotation = 1 + brake * (0.30 + fastCorner * 0.14);
  const targetAngularVelocity = steer
    * speedAuthority
    * lowSpeedBuild
    * tyreTurnFactor
    * surfaceGrip
    * Math.max(0.36, throttleUndersteer)
    * liftRotation
    * brakingRotation;
  const angularResponse = 1 - Math.exp(-Math.max(0, dt) * (4.4 + (1 - highSpeedSlip) * 2.0));
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
