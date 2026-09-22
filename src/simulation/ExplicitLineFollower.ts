import { referenceSteerForCurvature } from './ReferenceDriverModel';
import type { TrackId } from './TrackModel';
import { projectTrackNear, sampleTrack, TRACK_LENGTH } from './TrackModel';
import {
  activeReferenceTarget,
  projectRuntimeRacingLineNear,
} from './RacingLineRuntime';
import type { VehicleState } from './VehicleModel';

export interface ExplicitLineFollowerTarget {
  steer: number;
  lookAheadMetres: number;
  steeringProgress: number;
  targetLane: number;
  pathProgress: number;
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
  const lineProjection = projectRuntimeRacingLineNear(
    trackId,
    vehicle.x,
    vehicle.y,
    projection.progress,
  );
  const pathProgress = lineProjection.progress;
  const currentReference = activeReferenceTarget(
    trackId,
    pathProgress,
    tireGrip,
  );
  const errorSeverity = clamp(lineProjection.distance / 5.5, 0, 1);

  // Use one near target for cross-track convergence and a separate farther
  // preview for anticipation. The previous follower shortened lookahead as the
  // error grew; in Pitwall's final S-complex that made the car discover a
  // left/right lane transition only after it was already on the wrong side.
  const nominalLookAhead = clamp(12 + vehicle.speed * 0.18, 18, 34);
  const lookAheadMetres = nominalLookAhead * (1 - errorSeverity * 0.14);
  const steeringProgress = wrap01(
    pathProgress + lookAheadMetres / TRACK_LENGTH,
  );
  const targetReference = activeReferenceTarget(
    trackId,
    steeringProgress,
    tireGrip,
  );
  const target = sampleTrack(steeringProgress, targetReference.laneOffset);

  const headingProbeMetres = clamp(4.5 + vehicle.speed * 0.025, 5, 7);
  const pathAheadProgress = wrap01(
    pathProgress + headingProbeMetres / TRACK_LENGTH,
  );
  const pathAheadReference = activeReferenceTarget(
    trackId,
    pathAheadProgress,
    tireGrip,
  );
  const pathNow = sampleTrack(
    pathProgress,
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
  const pathNormalX = -Math.sin(pathHeading);
  const pathNormalY = Math.cos(pathHeading);
  const signedOffsetFromPath =
    (vehicle.x - pathNow.x) * pathNormalX
    + (vehicle.y - pathNow.y) * pathNormalY;
  const laneError = -signedOffsetFromPath;

  const targetBearing = Math.atan2(
    target.y - vehicle.y,
    target.x - vehicle.x,
  );
  const pathHeadingError = wrapAngle(pathHeading - vehicle.heading);
  const bearingError = wrapAngle(targetBearing - vehicle.heading);

  // Preview the *shape* of the explicit path well beyond the near pursuit
  // target. This is feed-forward only: it rotates the car before an S-bend
  // changes side, without asking the car to cut directly toward a far-away
  // point.
  const previewMetres = clamp(24 + vehicle.speed * 0.26, 32, 58);
  const previewProgress = wrap01(
    pathProgress + previewMetres / TRACK_LENGTH,
  );
  const previewReference = activeReferenceTarget(
    trackId,
    previewProgress,
    tireGrip,
  );
  const previewPoint = sampleTrack(
    previewProgress,
    previewReference.laneOffset,
  );
  const previewAheadProgress = wrap01(
    previewProgress + headingProbeMetres / TRACK_LENGTH,
  );
  const previewAheadReference = activeReferenceTarget(
    trackId,
    previewAheadProgress,
    tireGrip,
  );
  const previewAhead = sampleTrack(
    previewAheadProgress,
    previewAheadReference.laneOffset,
  );
  const previewHeading = Math.atan2(
    previewAhead.y - previewPoint.y,
    previewAhead.x - previewPoint.x,
  );
  const headingLead = wrapAngle(previewHeading - pathHeading);
  const leadWeight = clamp(vehicle.speed / 72, 0.38, 1);

  // A chicane can move the explicit line from one side of the road to the
  // other while the path headings before and after the transition are nearly
  // parallel. Heading preview alone then misses the most important information.
  // Read the recorded lane schedule directly and begin that lateral transfer
  // before the near pursuit target reaches it.
  const laneTransitionAngle = Math.atan2(
    previewReference.laneOffset - currentReference.laneOffset,
    Math.max(12, previewMetres),
  );

  // The cross-track term is intentionally speed-aware: at high speed the
  // heading terms do most of the work, while a multi-metre miss still commands
  // an unmistakable correction instead of the old /9 soft nudge.
  const crossTrackAngle = Math.atan2(
    laneError * (2.6 + errorSeverity * 1.8),
    Math.max(16, vehicle.speed),
  );

  // Feed forward the steering that the shared chassis physics says is required
  // by the *upcoming explicit-path curvature*. This replaces guesswork with the
  // same yaw capability model used by the machine reference solver, while
  // still deriving everything from line + speed rather than replaying pedals.
  const curvatureLeadMetres = clamp(vehicle.speed * 0.55, 14, 34);
  const curvatureProgress = wrap01(
    pathProgress + curvatureLeadMetres / TRACK_LENGTH,
  );
  const curvatureProbeMetres = clamp(7.5 + vehicle.speed * 0.045, 8, 12);
  const beforeProgress = wrap01(
    curvatureProgress - curvatureProbeMetres / TRACK_LENGTH,
  );
  const afterProgress = wrap01(
    curvatureProgress + curvatureProbeMetres / TRACK_LENGTH,
  );
  const beforeReference = activeReferenceTarget(trackId, beforeProgress, tireGrip);
  const atReference = activeReferenceTarget(trackId, curvatureProgress, tireGrip);
  const afterReference = activeReferenceTarget(trackId, afterProgress, tireGrip);
  const beforePoint = sampleTrack(beforeProgress, beforeReference.laneOffset);
  const atPoint = sampleTrack(curvatureProgress, atReference.laneOffset);
  const afterPoint = sampleTrack(afterProgress, afterReference.laneOffset);
  const signedCurvature = pathCurvature(beforePoint, atPoint, afterPoint);
  const feedForwardSteer = referenceSteerForCurvature(
    Math.max(vehicle.speed, atReference.targetSpeed * 0.92),
    signedCurvature,
    tireGrip,
  );
  const steer = clamp(
    feedForwardSteer * 0.92
      + pathHeadingError * (1.72 + errorSeverity * 0.38)
      + bearingError * (0.94 + errorSeverity * 0.24)
      + crossTrackAngle * 3.35
      + headingLead * (0.70 + leadWeight * 0.52)
      + laneTransitionAngle * (1.55 + leadWeight * 0.70)
      - vehicle.yawRate * 0.30,
    -1,
    1,
  );

  return {
    steer,
    lookAheadMetres,
    steeringProgress,
    targetLane: targetReference.laneOffset,
    pathProgress,
    referenceLane: currentReference.laneOffset,
    laneError,
    pathHeadingError,
    bearingError,
  };
}

function pathCurvature(
  previous: { x: number; y: number },
  current: { x: number; y: number },
  next: { x: number; y: number },
): number {
  const ab = Math.hypot(current.x - previous.x, current.y - previous.y);
  const bc = Math.hypot(next.x - current.x, next.y - current.y);
  const ac = Math.hypot(next.x - previous.x, next.y - previous.y);
  const denominator = ab * bc * ac;
  if (denominator < 0.0001) return 0;
  const cross =
    (current.x - previous.x) * (next.y - previous.y)
    - (current.y - previous.y) * (next.x - previous.x);
  return (2 * cross) / denominator;
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
