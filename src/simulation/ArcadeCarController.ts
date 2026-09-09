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
  tireWear?: number;
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
 * Arcade handling where tyre grip primarily changes braking, rotation and
 * combined traction. Compound choice should not behave like an engine map:
 * with the wheel straight, S/M/H accelerate almost the same way.
 *
 * Wear is deliberately simpler than a tyre simulation. A worn tyre can still
 * rotate the car, but when the player asks for a lot of steering at speed it
 * hangs onto lateral motion for longer and scrubs forward speed. In game terms:
 * sliding is readable time loss, not a realism goal of its own.
 */
export function controlArcadeCar(
  motion: PlanarMotion,
  input: ArcadeCarInput,
  dt: number,
): ArcadeCarControlResult {
  const throttle = clamp01(input.throttle);
  const brake = clamp01(input.brake);
  const steer = clamp(input.steer, -1, 1);
  const tireGrip = clamp(input.tireGrip, 0.30, 1.42);
  const tireWear = clamp01(input.tireWear ?? 0);
  const surfaceGrip = clamp(input.surfaceGrip ?? 1, 0.42, 1.05);
  const powerBoost = clamp(input.powerBoost ?? 0, -0.55, 0.48);
  const powerMultiplier = clamp(input.powerMultiplier ?? 1, 0.3, 1.1);
  const rollingResistance = clamp(input.rollingResistance ?? 0, 0, 14);

  const cos = Math.cos(motion.heading);
  const sin = Math.sin(motion.heading);
  const rightX = -sin;
  const rightY = cos;

  const forwardSpeed = motion.vx * cos + motion.vy * sin;
  const lateralSpeed = motion.vx * rightX + motion.vy * rightY;
  const speed = Math.hypot(motion.vx, motion.vy);
  const normalizedGrip = clamp01((tireGrip - 0.30) / 1.04);
  const superGrip = Math.max(0, tireGrip - 1);
  const wornSlip = Math.pow(clamp01((tireWear - 0.28) / 0.72), 1.35);

  // A small global speed lift: enough to make straights feel more urgent after
  // pulling the camera back, without turning starts into rocket launches.
  const usefulTopSpeed = 123 + powerBoost * 58;
  const positiveForward = Math.max(0, forwardSpeed);
  const speedRatio = clamp01(positiveForward / Math.max(60, usefulTopSpeed));
  const powerTaper = Math.max(0, 1 - Math.pow(speedRatio, 1.90));

  const steeringLoad = Math.abs(steer) * clamp01(speed / 88);
  const straightTraction = 0.985 + normalizedGrip * 0.015;
  const combinedTraction = 1 - steeringLoad * throttle * (0.08 + (1 - normalizedGrip) * 0.48);
  const engineAcceleration = throttle
    * 14.15
    * powerTaper
    * (1 + powerBoost * 0.58)
    * powerMultiplier
    * straightTraction
    * Math.max(0.38, combinedTraction);

  const aeroDrag = 0.000235 * speed * speed;
  const rollingDrag = 0.55 + rollingResistance;
  // Runoff/grass must not be a shortcut at race speed, but it still has to let
  // a nearly stopped car drive back to the circuit. Derive a speed-dependent
  // rough-surface drag from the grip loss: mild at walking pace, severe at
  // 250-350 km/h.
  const roughSurface = clamp01((1 - surfaceGrip) / 0.50);
  const roughSurfaceDrag = roughSurface
    * (0.80 + speed * 0.045 + speed * speed * 0.00070);

  // Old tyres do not simply "refuse to turn". When steering demand is high,
  // they scrub speed instead. This makes the player feel the stint age through
  // lap time while keeping the car controllable enough to race.
  const wearSlideDrag = wornSlip
    * steeringLoad
    * (0.55 + throttle * 0.45)
    * (1.35 + speed * 0.055);

  const brakingGrip = (0.20 + normalizedGrip * 0.98 + superGrip * 0.26) * surfaceGrip;
  const brakingAcceleration = brake * 31.5 * brakingGrip;

  let longitudinalAcceleration = engineAcceleration - aeroDrag - rollingDrag - roughSurfaceDrag - wearSlideDrag;
  if (Math.abs(forwardSpeed) > 0.15) {
    longitudinalAcceleration -= Math.sign(forwardSpeed) * brakingAcceleration;
  } else if (brake > 0.05) {
    longitudinalAcceleration = Math.min(0, longitudinalAcceleration);
  }

  let nextForward = forwardSpeed + longitudinalAcceleration * dt;
  if (brake > 0 && forwardSpeed > 0 && nextForward < 0) nextForward = 0;
  if (throttle >= 0 && nextForward < -3) nextForward = -3;

  const highSpeedSlip = clamp01(speed / 132);
  const tyreLateralAuthority = 0.34 + Math.pow(normalizedGrip, 1.86) * 1.52 + superGrip * 0.55;
  const wearLateralRetention = 1 - wornSlip * steeringLoad * 0.42;
  const lateralGripRate = 9.35
    * tyreLateralAuthority
    * surfaceGrip
    * (1 - highSpeedSlip * 0.22)
    * wearLateralRetention;
  const lateralRetention = Math.exp(-lateralGripRate * Math.max(0, dt));
  const nextLateral = lateralSpeed * lateralRetention;

  // Keep high-speed cornering demanding, but make the whole car willing to
  // rotate. Wear is intentionally not multiplied directly into this authority;
  // the main late-stint penalty is the slide/speed-loss behaviour above.
  const speedAuthority = 2.52 / (1 + Math.pow(speed / 49, 1.62)) + 0.060;
  const lowSpeedBuild = clamp01(speed / 12);
  const fastCorner = clamp01((speed - 38) / 66);
  const freshHighSpeedAuthority = 0.16
    + Math.pow(normalizedGrip, 1.90) * 1.40
    + superGrip * 0.76;
  const tyreTurnFactor = (1 - fastCorner) * (0.66 + normalizedGrip * 0.54)
    + fastCorner * freshHighSpeedAuthority;
  const throttleUndersteer = 1 - throttle * Math.abs(steer) * fastCorner * (0.07 + (1 - normalizedGrip) * 0.50);
  const liftRotation = throttle < 0.12 && brake < 0.08 ? 1.10 : 1;
  const brakingRotation = 1 + brake * (0.28 + fastCorner * 0.14);
  const targetAngularVelocity = steer
    * speedAuthority
    * lowSpeedBuild
    * tyreTurnFactor
    * surfaceGrip
    * Math.max(0.38, throttleUndersteer)
    * liftRotation
    * brakingRotation;
  const angularResponse = 1 - Math.exp(-Math.max(0, dt) * (4.8 + (1 - highSpeedSlip) * 2.0));
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
