import { controlArcadeCar } from './ArcadeCarController';
import { REFERENCE_POWER_BOOST } from './ReferenceDriverModel';
import { activeReferenceLaneOffset, activeReferenceTarget } from './RacingLineRuntime';
import { sampleTrack, TRACK_LENGTH, type TrackId } from './TrackModel';
import type { VehicleState } from './VehicleModel';

const CANDIDATES = [-1, -0.78, -0.52, -0.26, 0, 0.26, 0.52, 0.78, 1] as const;
const LINEAR_DAMPING = 0.018;
const ANGULAR_DAMPING = 1.05;

/**
 * Model-predictive correction for explicit PLAYER/EDITOR paths.
 *
 * A single far-away pursuit target is fundamentally ambiguous in an S-bend:
 * it can skip the first apex in order to point at the second. Instead each
 * steering candidate is applied only as a short initial action, then the same
 * simulated chassis is allowed to follow successive explicit-path samples.
 * The candidate that leaves that future closed loop closest to the whole path
 * is chosen.
 */
export function predictiveExplicitLineSteer(
  trackId: TrackId,
  vehicle: VehicleState,
  tireGrip: number,
  pathProgress: number,
  baselineSteer: number,
): number {
  if (vehicle.speed < 12) return baselineSteer;

  const horizon = clamp(0.78 + 10 / Math.max(40, vehicle.speed), 0.78, 1.02);
  const steps = 14;
  const dt = horizon / steps;
  const initialSteps = 2;

  let bestSteer = baselineSteer;
  let bestScore = Number.POSITIVE_INFINITY;
  const candidates = [...CANDIDATES, clamp(baselineSteer, -1, 1)];

  for (const candidate of candidates) {
    const score = scoreCandidate(
      candidate,
      trackId,
      vehicle,
      tireGrip,
      pathProgress,
      baselineSteer,
      dt,
      steps,
      initialSteps,
    );
    if (score < bestScore) {
      bestScore = score;
      bestSteer = candidate;
    }
  }

  // Keep the continuous follower authoritative. The predictor supplies the
  // early S-bend correction, but must not replace a stable high-speed steering
  // solution merely because one discrete future candidate scores slightly
  // better.
  return clamp(baselineSteer * 0.52 + bestSteer * 0.48, -1, 1);
}

function scoreCandidate(
  initialSteer: number,
  trackId: TrackId,
  vehicle: VehicleState,
  tireGrip: number,
  startProgress: number,
  baselineSteer: number,
  dt: number,
  steps: number,
  initialSteps: number,
): number {
  let x = vehicle.x;
  let y = vehicle.y;
  let heading = vehicle.heading;
  let yaw = vehicle.yawRate;
  let vx = Math.cos(heading) * vehicle.speed;
  let vy = Math.sin(heading) * vehicle.speed;
  let progress = wrap01(startProgress);
  let score = 0;

  for (let step = 0; step < steps; step++) {
    const speed = Math.hypot(vx, vy);
    const reference = activeReferenceTarget(trackId, progress, tireGrip);
    const steer = step < initialSteps
      ? initialSteer
      : futureFollowerSteer(
          trackId,
          x,
          y,
          heading,
          yaw,
          speed,
          tireGrip,
          progress,
        );

    const speedError = reference.targetSpeed - speed;
    const brake = speedError < -0.8
      ? clamp((-speedError - 0.4) / 8.5, 0, 1)
      : 0;
    const throttle = brake > 0.05
      ? 0
      : speedError > 0.6
        ? 1
        : clamp(0.48 + speedError * 0.22, 0.12, 0.72);

    const controlled = controlArcadeCar(
      { vx, vy, heading, angularVelocity: yaw },
      {
        throttle,
        brake,
        steer,
        tireGrip,
        powerBoost: REFERENCE_POWER_BOOST,
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

    const nextSpeed = Math.hypot(vx, vy);
    progress = wrap01(progress + nextSpeed * dt / TRACK_LENGTH);

    const path = explicitPathPose(trackId, progress, tireGrip);
    const dx = x - path.x;
    const dy = y - path.y;
    const pathDistance = Math.hypot(dx, dy);
    const headingError = Math.abs(wrapAngle(path.heading - heading));
    const urgency = 0.65 + step / Math.max(1, steps - 1);

    // Squared distance makes a future barrier-bound excursion dominate a
    // sequence of harmless sub-metre misses. Heading keeps the simulated car
    // prepared for the next sample instead of merely crossing the path once.
    score += pathDistance * pathDistance * 0.075 * urgency
      + headingError * headingError * 5.4 * urgency;
  }

  score += Math.abs(initialSteer - baselineSteer) * 0.18;
  return score;
}

function futureFollowerSteer(
  trackId: TrackId,
  x: number,
  y: number,
  heading: number,
  yaw: number,
  speed: number,
  tireGrip: number,
  progress: number,
): number {
  const current = explicitPathPose(trackId, progress, tireGrip);
  const lookAhead = clamp(9 + speed * 0.10, 12, 22);
  const futureProgress = wrap01(progress + lookAhead / TRACK_LENGTH);
  const future = explicitPathPose(trackId, futureProgress, tireGrip);

  const targetBearing = Math.atan2(future.y - y, future.x - x);
  const bearingError = wrapAngle(targetBearing - heading);
  const headingError = wrapAngle(current.heading - heading);
  const normalX = -Math.sin(current.heading);
  const normalY = Math.cos(current.heading);
  const signedOffset = (x - current.x) * normalX + (y - current.y) * normalY;
  const crossTrack = Math.atan2(-signedOffset * 3.0, Math.max(16, speed));

  return clamp(
    headingError * 2.0
      + bearingError * 1.15
      + crossTrack * 3.2
      - yaw * 0.30,
    -1,
    1,
  );
}

function explicitPathPose(
  trackId: TrackId,
  progress: number,
  tireGrip: number,
): { x: number; y: number; heading: number } {
  const point = sampleTrack(progress, activeReferenceLaneOffset(trackId, progress, tireGrip));
  const aheadProgress = wrap01(progress + 5 / TRACK_LENGTH);
  const ahead = sampleTrack(aheadProgress, activeReferenceLaneOffset(trackId, aheadProgress, tireGrip));
  return {
    x: point.x,
    y: point.y,
    heading: Math.atan2(ahead.y - point.y, ahead.x - point.x),
  };
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
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
