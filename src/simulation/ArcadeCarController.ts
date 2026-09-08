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
 *
 * The physics engine owns integration and contacts. This controller only
 * describes the tyre/engine intent for one fixed step: longitudinal drive and
 * braking, lateral tyre scrub and a speed-dependent target yaw rate.
 *
 * Units are intentionally metres/seconds-ish so the HUD and track scale have a
 * coherent relationship. It is tuned for game feel, not an F1 telemetry model.
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

  // The useful speed envelope changes with hybrid mode, but acceleration still
  // has to take time. This replaces the old almost-instant jump to a speed cap.
  const usefulTopSpeed = 92 + powerBoost * 43;
  const positiveForward = Math.max(0, forwardSpeed);
  const speedRatio = clamp01(positiveForward / Math.max(55, usefulTopSpeed));
  const powerTaper = Math.max(0, 1 - Math.pow(speedRatio, 1.75));
  const engineAcceleration = throttle
    * 13.2
    * powerTaper
    * (1 + powerBoost * 0.58)
    * powerMultiplier;

  const aeroDrag = 0.00036 * speed * speed;
  const rollingDrag = 0.72 + rollingResistance;
  const brakingAcceleration = brake * 24.5 * (0.82 + tireGrip * 0.18) * surfaceGrip;

  let longitudinalAcceleration = engineAcceleration - aeroDrag - rollingDrag;
  if (Math.abs(forwardSpeed) > 0.15) {
    longitudinalAcceleration -= Math.sign(forwardSpeed) * brakingAcceleration;
  } else if (brake > 0.05) {
    longitudinalAcceleration = Math.min(0, longitudinalAcceleration);
  }

  let nextForward = forwardSpeed + longitudinalAcceleration * dt;
  if (brake > 0 && forwardSpeed > 0 && nextForward < 0) nextForward = 0;
  if (throttle >= 0 && nextForward < -3) nextForward = -3;

  // Real velocity has a lateral component now. Tyres progressively scrub that
  // component instead of the car being mathematically welded to its heading.
  // At high speed the scrub is intentionally a little weaker, so asking too
  // much steering creates visible understeer rather than a magic tight turn.
  const highSpeedSlip = clamp01(speed / 115);
  const lateralGripRate = 8.4 * tireGrip * surfaceGrip * (1 - highSpeedSlip * 0.28);
  const lateralRetention = Math.exp(-lateralGripRate * Math.max(0, dt));
  const nextLateral = lateralSpeed * lateralRetention;

  // Steering authority falls hard with speed. Roughly: responsive in a hairpin,
  // moderate around 200 km/h, and a large-radius arc above 300 km/h.
  const speedAuthority = 1.65 / (1 + Math.pow(speed / 38, 1.85)) + 0.055;
  const lowSpeedBuild = clamp01(speed / 14);
  const brakingRotation = 1 + brake * 0.16;
  const targetAngularVelocity = steer
    * speedAuthority
    * lowSpeedBuild
    * tireGrip
    * surfaceGrip
    * brakingRotation;
  const angularResponse = 1 - Math.exp(-Math.max(0, dt) * (4.2 + (1 - highSpeedSlip) * 2.4));
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
