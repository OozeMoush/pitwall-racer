import { controlArcadeCar } from './ArcadeCarController';
import type { TrackPoint } from './TrackModel';
import type { VehicleState } from './VehicleModel';

const CANDIDATES = [-1, -0.78, -0.56, -0.34, -0.14, 0, 0.14, 0.34, 0.56, 0.78, 1] as const;
const LINEAR_DAMPING = 0.018;
const ANGULAR_DAMPING = 1.05;
const POWER_BOOST = 0.22;

/**
 * Pick a steering command by asking the same arcade chassis a small question:
 * "if I held this steering input for the next few tenths, where would I be?"
 *
 * Humans are naturally predictive through a chicane: they start the second
 * rotation before the current lateral error becomes large. The old controller
 * was almost entirely reactive, so it could have a correct reference line and
 * still arrive at every second apex late. This helper evaluates a tiny set of
 * steering candidates with the real controlArcadeCar equations and chooses the
 * one that best reaches the already-planned target point/tangent.
 *
 * This is controller intelligence only. It does not add grip, power or speed,
 * and the command still goes through the shared Rapier chassis afterwards.
 */
export function predictiveAiSteer(
  vehicle: VehicleState,
  tireGrip: number,
  target: TrackPoint,
  tangent: TrackPoint,
  baselineSteer: number,
  weight: number,
): number {
  const blend = clamp(weight, 0, 1);
  if (blend <= 0.001 || vehicle.speed < 18) return baselineSteer;

  const targetHeading = Math.atan2(tangent.y - target.y, tangent.x - target.x);
  const targetDistance = Math.hypot(target.x - vehicle.x, target.y - vehicle.y);
  const horizon = clamp(targetDistance / Math.max(34, vehicle.speed), 0.18, 0.48);
  const steps = 6;
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
        powerBoost: POWER_BOOST,
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

  // Position is the primary objective. Heading/bearing make two candidates that
  // arrive similarly prefer the one already rotated for the exit, while a tiny
  // continuity term prevents candidate quantisation from creating visible saw.
  return positionError
    + headingError * 8.5
    + bearingError * 3.2
    + steeringChange * 0.38;
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
