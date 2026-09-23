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
  slideSeverity?: number;
  slideDirection?: number;
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
 * Game-facing handling rather than a slip-angle simulation. Compound grip
 * changes braking, corner speed and how much speed can be carried, while the
 * basic steering stays generous enough that every dry tyre is enjoyable.
 *
 * Tyre age is handled outside this pure controller as short slide events. When
 * one fires, the rear steps outward, yaw rises and forward speed is scrubbed.
 * That is deliberately more obvious than the old permanent "slightly less
 * grip" penalty: the player should be able to point at the moment they lost
 * time.
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
  const surfaceGrip = clamp(input.surfaceGrip ?? 1, 0.42, 1.05);
  const powerBoost = clamp(input.powerBoost ?? 0, -0.55, 0.48);
  const powerMultiplier = clamp(input.powerMultiplier ?? 1, 0.3, 1.1);
  const rollingResistance = clamp(input.rollingResistance ?? 0, 0, 14);
  const slideSeverity = clamp(input.slideSeverity ?? 0, 0, 1.5);
  const slideDirection = clamp(input.slideDirection ?? 0, -1, 1);

  const cos = Math.cos(motion.heading);
  const sin = Math.sin(motion.heading);
  const rightX = -sin;
  const rightY = cos;

  const forwardSpeed = motion.vx * cos + motion.vy * sin;
  const lateralSpeed = motion.vx * rightX + motion.vy * rightY;
  const speed = Math.hypot(motion.vx, motion.vy);
  const normalizedGrip = clamp01((tireGrip - 0.30) / 1.04);
  // Compress grip's effect on the steering rack. A Hard tyre should give away
  // corner speed, not make WASD steering feel broken.
  const steeringGrip = 0.46 + normalizedGrip * 0.54;
  const superGrip = Math.max(0, tireGrip - 1);

  // A small global speed lift: enough to make straights feel urgent without
  // turning starts into rocket launches.
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
  // Grass must be categorically slower than staying on the circuit at race
  // speed, while a nearly stopped car still needs enough engine to recover.
  // Put the extra cost in the speed-squared term rather than constant drag.
  const roughSurface = clamp01((1 - surfaceGrip) / 0.50);
  const roughSurfaceDrag = roughSurface
    * (0.82 + speed * 0.055 + speed * speed * 0.00165);

  // A triggered rear slide is intentionally decisive and short. It costs a
  // handful of km/h and creates visible lateral motion instead of silently
  // reducing steering authority for an entire stint.
  const rearSlideDrag = slideSeverity
    * (0.72 + steeringLoad * 0.42)
    * (4.8 + speed * 0.105);

  const brakingGrip = (0.20 + normalizedGrip * 0.98 + superGrip * 0.26) * surfaceGrip;
  const brakingAcceleration = brake * 31.5 * brakingGrip;

  let longitudinalAcceleration = engineAcceleration - aeroDrag - rollingDrag - roughSurfaceDrag - rearSlideDrag;
  if (Math.abs(forwardSpeed) > 0.15) {
    longitudinalAcceleration -= Math.sign(forwardSpeed) * brakingAcceleration;
  } else if (brake > 0.05) {
    longitudinalAcceleration = Math.min(0, longitudinalAcceleration);
  }

  let nextForward = forwardSpeed + longitudinalAcceleration * dt;
  if (brake > 0 && forwardSpeed > 0 && nextForward < 0) nextForward = 0;
  if (throttle >= 0 && nextForward < -3) nextForward = -3;

  const highSpeedSlip = clamp01(speed / 132);
  const tyreLateralAuthority = 0.34 + Math.pow(steeringGrip, 1.70) * 1.52 + superGrip * 0.55;
  const slideLateralRetention = Math.max(0.06, 1 - slideSeverity * 0.72);
  const lateralGripRate = 10.15
    * tyreLateralAuthority
    * surfaceGrip
    * (1 - highSpeedSlip * 0.20)
    * slideLateralRetention;
  const lateralRetention = Math.exp(-lateralGripRate * Math.max(0, dt));
  const rearStepAcceleration = slideDirection
    * slideSeverity
    * clamp01(speed / 78)
    * (11.8 + speed * 0.105);
  const nextLateral = lateralSpeed * lateralRetention + rearStepAcceleration * Math.max(0, dt);

  // The miniature circuit has substantially tighter physical radii than the
  // old kilometre-scale layout. Preserve the same arcade intent by increasing
  // rotation authority rather than forcing the whole field to crawl through
  // corners. The result should feel like a fast toy-scale racer, not a sim car
  // squeezed onto a tiny map.
  const speedAuthority = (2.72 / (1 + Math.pow(speed / 51, 1.60)) + 0.070) * 1.42;
  const normalLowSpeedBuild = clamp01(speed / 12);
  // A car stopped against a wall on grass used to have exactly zero steering
  // authority, so throttle could only push it harder into the barrier. Rough
  // surfaces now provide a modest arcade recovery floor. Asphalt behavior is
  // unchanged: a stationary car still cannot pivot in place on the circuit.
  const roughRecoveryFloor = roughSurface * 0.34;
  const lowSpeedBuild = Math.max(normalLowSpeedBuild, roughRecoveryFloor);
  const fastCorner = clamp01((speed - 38) / 66);
  const freshHighSpeedAuthority = 0.18
    + Math.pow(steeringGrip, 1.68) * 1.42
    + superGrip * 0.76;
  const tyreTurnFactor = (1 - fastCorner) * (0.69 + steeringGrip * 0.53)
    + fastCorner * freshHighSpeedAuthority;
  const throttleUndersteer = 1 - throttle * Math.abs(steer) * fastCorner * (0.055 + (1 - normalizedGrip) * 0.42);
  const liftRotation = throttle < 0.12 && brake < 0.08 ? 1.10 : 1;
  const brakingRotation = 1 + brake * (0.28 + fastCorner * 0.14);
  const slideRotation = 1 + slideSeverity * 0.82;
  const targetAngularVelocity = steer
    * speedAuthority
    * lowSpeedBuild
    * tyreTurnFactor
    * surfaceGrip
    * Math.max(0.44, throttleUndersteer)
    * liftRotation
    * brakingRotation
    * slideRotation;
  const angularResponse = 1 - Math.exp(-Math.max(0, dt) * (5.35 + (1 - highSpeedSlip) * 2.0 + slideSeverity * 1.8));
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
