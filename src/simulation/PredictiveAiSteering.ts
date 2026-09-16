import { controlArcadeCar } from './ArcadeCarController';
import type { TrackPoint } from './TrackModel';
import type { VehicleState } from './VehicleModel';

const CANDIDATES = [-1, -0.78, -0.56, -0.34, -0.14, 0, 0.14, 0.34, 0.56, 0.78, 1] as const;
const LINEAR_DAMPING = 0.018;
const ANGULAR_DAMPING = 1.05;

/**
 * Pick a steering command by asking the same arcade chassis a small question:
 * "if I held this steering input for the next few tenths, where would I be?"
 *
 * Humans are naturally predictive through a chicane: they start the second
 * rotation before the current lateral error becomes large. The ordinary AI
 * controller is mostly reactive, so this helper can provide an early hint
 * without changing the actual car's grip, power, speed or braking targets.
 *
 * This remains a tie-breaker around the stable closed-loop controller. A
 * slightly longer horizon lets it see the second half of Pitwall's compact
 * direction changes, while the steering-continuity cost and hard blend cap
 * prevent it from becoming the old unstable apex-to-apex controller.
 */
export function predictiveAiSteer(
  vehicle: VehicleState,
  tireGrip: number,
  target: TrackPoint,
  tangent: TrackPoint,
  baselineSteer: number,
  weight: number,
): number {
  const blend = clamp(weight * 1.45, 0, 0.52);
  if (blend <= 0.001 || vehicle.speed < 18) return baselineSteer;

  const targetHeading = Math.atan2(tangent.y - target.y, tangent.x - target.x);
  const targetDistance = Math.hypot(target.x - vehicle.x, target.y - vehicle.y);
  const horizon = clamp(targetDistance / Math.max(38, vehicle.speed), 0.16, 0.42);
  const steps = 8;
  const dt = horizon / steps;

  let bestSteer = baselineSteer;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of CANDIDATES) {
    const score = scoreCandidate(
      candidate,
      vehicle,
      tireGrip,
      target,
      targetHeading,
      dt,
      steps,
      baselineSteer,
    );
    if (score < bestScore) {
      bestScore = score;
      bestSteer = candidate;
    }
  }

  return clamp(lerp(baselineSteer, bestSteer, blend), -1, 1);
}

function scoreCandidate(
  steer: number,
  vehicle: VehicleState,
  tireGrip: number,
  target: TrackPoint,
  targetHeading: number,
  dt: number,
  steps: number,
  baselineSteer: number,
): number {
  let x = vehicle.x;
  let y = vehicle.y;
  let heading = vehicle.heading;
  let yaw = vehicle.yawRate;
  let vx = Math.cos(heading) * vehicle.speed;
  let vy = Math.sin(heading) * vehicle.speed;

  for (let step = 0; step < steps; step++) {
    const controlled = controlArcadeCar(
      { vx, vy, heading, angularVelocity: yaw },
      {
        throttle: 0.35,
        brake: 0,
        steer,
        tireGrip,
        powerBoost: 0,
      },
      dt,
    );

    const linearDamping = 1 / (1 + LINEAR_DAMPING * dt);
    const angularDamping = 1 / (1 + ANGULAR_DAMPING * dt);
    vx = controlled.vx * linearDamping;
    vy = controlled.vy * linearDamping;
    yaw = controlled.angularVelocity * angularDamping;
    heading += yaw * dt;
    x += vx * dt;
    y += vy * dt;
  }

  const positionError = Math.hypot(target.x - x, target.y - y);
  const headingError = Math.abs(wrapAngle(targetHeading - heading));
  const targetBearing = Math.atan2(target.y - y, target.x - x);
  const bearingError = Math.abs(wrapAngle(targetBearing - heading));
  const steeringChange = Math.abs(steer - baselineSteer);

  // Position is primary. Heading/bearing prefer a candidate already rotated for
  // the exit, while continuity keeps the discrete candidate set from sawing.
  return positionError
    + headingError * 9.4
    + bearingError * 3.4
    + steeringChange * 0.92;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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
