import type { TrackId } from './TrackModel';
import { projectTrackNear, sampleTrack, TRACK_LENGTH } from './TrackModel';
import { activeReferenceTarget } from './RacingLineRuntime';
import type { VehicleState } from './VehicleModel';

export interface ExplicitLineFollowerTarget {
  steer: number;
  lookAheadMetres: number;
  steeringProgress: number;
  targetLane: number;
  referenceLane: number;
  laneError: number;
  pathHeadingError: number;
  bearingError: number;
}

/**
 * Strong path follower for physically demonstrated PLAYER/EDITOR lines.
 *
 * AUTO is allowed to be a softer "drive toward the machine reference"
 * controller. An explicit line is different: it is a path that has already
 * been proven by the real player chassis, so the controller should treat it as
 * authoritative. This follower combines:
 * - local path heading, so the car rotates with the line instead of reacting
 *   only after lateral error has appeared;
 * - a short pure-pursuit bearing target;
 * - a Stanley-style cross-track correction that becomes stronger as the car
 *   falls away from the line;
 * - yaw damping to avoid oscillation after a large correction.
 */
export function explicitLineFollower(
  trackId: TrackId,
  vehicle: VehicleState,
  referenceProgress: number,
  tireGrip: number,
): ExplicitLineFollowerTarget {
  const projection = projectTrackNear(
    vehicle.x,
    vehicle.y,
    referenceProgress,
  );
  const currentReference = activeReferenceTarget(
    trackId,
    projection.progress,
    tireGrip,
  );

  const laneError = currentReference.laneOffset - projection.laneOffset;
  const errorSeverity = clamp(Math.abs(laneError) / 5.5, 0, 1);

  // Human edge lines need a substantially shorter target than AUTO. When the
  // car is already displaced, shorten it further: looking far through the
  // corner while several metres off-line is what caused the old controller to
  // cut across the demonstrated path and reach the barrier.
  const nominalLookAhead = clamp(8 + vehicle.speed * 0.13, 13, 28);
  const lookAheadMetres = nominalLookAhead * (1 - errorSeverity * 0.32);
  const steeringProgress = wrap01(
    projection.progress + lookAheadMetres / TRACK_LENGTH,
  );
  const targetReference = activeReferenceTarget(
    trackId,
    steeringProgress,
    tireGrip,
  );
  const target = sampleTrack(steeringProgress, targetReference.laneOffset);

  const headingProbeMetres = clamp(4.5 + vehicle.speed * 0.025, 5, 7);
  const pathAheadProgress = wrap01(
    projection.progress + headingProbeMetres / TRACK_LENGTH,
  );
  const pathAheadReference = activeReferenceTarget(
    trackId,
    pathAheadProgress,
    tireGrip,
  );
  const pathNow = sampleTrack(
    projection.progress,
    currentReference.laneOffset,
  );
  const pathAhead = sampleTrack(
    pathAheadProgress,
    pathAheadReference.laneOffset,
  );
  const pathHeading = Math.atan2(
    pathAhead.y - pathNow.y,
    pathAhead.x - pathNow.x,
  );

  const targetBearing = Math.atan2(
    target.y - vehicle.y,
    target.x - vehicle.x,
  );
  const pathHeadingError = wrapAngle(pathHeading - vehicle.heading);
  const bearingError = wrapAngle(targetBearing - vehicle.heading);

  // The cross-track term is intentionally speed-aware: at high speed the
  // heading terms do most of the work, while a multi-metre miss still commands
  // an unmistakable correction instead of the old /9 soft nudge.
  const crossTrackAngle = Math.atan2(
    laneError * (2.6 + errorSeverity * 1.8),
    Math.max(16, vehicle.speed),
  );
  const steer = clamp(
    pathHeadingError * (2.35 + errorSeverity * 0.55)
      + bearingError * (1.25 + errorSeverity * 0.35)
      + crossTrackAngle * 3.65
      - vehicle.yawRate * 0.34,
    -1,
    1,
  );

  return {
    steer,
    lookAheadMetres,
    steeringProgress,
    targetLane: targetReference.laneOffset,
    referenceLane: currentReference.laneOffset,
    laneError,
    pathHeadingError,
    bearingError,
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
