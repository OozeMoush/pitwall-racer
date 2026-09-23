import { controlArcadeCar } from './ArcadeCarController';
import {
  REFERENCE_POWER_BOOST,
  referenceTarget,
  type ReferenceLapSample,
} from './ReferenceDriverModel';
import { sampleRacingLineAsset, type RacingLineAsset } from './RacingLineAsset';
import { sampleTrack, TRACK_LENGTH, type TrackId } from './TrackModel';

const active = new Map<TrackId, RacingLineAsset>();
const BRAKE_LOOKAHEAD_STEP_METRES = 12;
const MIN_BRAKE_LOOKAHEAD_METRES = 96;
const MAX_BRAKE_LOOKAHEAD_METRES = 240;
const AXF_SPEED_GUARD_DEADBAND = 4.0;
const AXF_SPEED_GUARD_CORRECTION_DISTANCE = 36;

export function setRuntimeRacingLine(
  trackId: TrackId,
  asset?: RacingLineAsset,
): void {
  if (!asset) {
    active.delete(trackId);
    return;
  }
  active.set(trackId, asset);
}

export function runtimeRacingLine(trackId: TrackId): RacingLineAsset | undefined {
  return active.get(trackId);
}

/**
 * Kinematic consistency check for a stored explicit line. This integrates the
 * actual polyline distance implied by progress + laneOffset against the stored
 * target-speed trace. It does not simulate controls; it answers whether the
 * asset itself is internally capable of representing its advertised lap time.
 */
export function racingLineTraceLapSeconds(
  asset: RacingLineAsset | undefined,
): number | undefined {
  if (!asset || asset.points.length < 2) return undefined;

  let seconds = 0;
  for (let index = 0; index < asset.points.length; index++) {
    const a = asset.points[index];
    const b = asset.points[(index + 1) % asset.points.length];
    const pa = a.worldX !== undefined && a.worldY !== undefined
      ? { x: a.worldX, y: a.worldY }
      : sampleTrack(a.progress, a.laneOffset);
    const pb = b.worldX !== undefined && b.worldY !== undefined
      ? { x: b.worldX, y: b.worldY }
      : sampleTrack(b.progress, b.laneOffset);
    const distance = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const averageSpeed = (Math.max(0, a.targetSpeed) + Math.max(0, b.targetSpeed)) * 0.5;
    if (!Number.isFinite(distance) || !Number.isFinite(averageSpeed) || averageSpeed < 1) {
      return undefined;
    }
    seconds += distance / averageSpeed;
  }

  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

export interface RuntimeRacingLinePose {
  x: number;
  y: number;
  heading: number;
  laneOffset: number;
  targetSpeed: number;
  demonstratedHeading?: number;
}

/**
 * Sample an explicit PLAYER/EDITOR trajectory in world space.
 *
 * laneOffset and headingOffset are stored relative to the piecewise centreline.
 * Interpolating those relative values first and only then applying the current
 * segment frame creates a discontinuity when the centreline segment changes,
 * most visibly at the start/finish seam. Reconstruct the two stored endpoints
 * in world space instead, interpolate their positions directly, and interpolate
 * demonstrated *absolute* body heading rather than the relative offset.
 */
export function sampleRuntimeRacingLinePose(
  trackId: TrackId,
  progress: number,
): RuntimeRacingLinePose {
  const asset = active.get(trackId);
  if (!asset || asset.points.length === 0) {
    const reference = activeReferenceTarget(trackId, progress, 1);
    const pose = sampleTrack(progress, reference.laneOffset);
    return {
      x: pose.x,
      y: pose.y,
      heading: pose.heading,
      laneOffset: reference.laneOffset,
      targetSpeed: reference.targetSpeed,
    };
  }

  const p = wrap01(progress);
  const scaled = p * asset.points.length;
  const index = Math.floor(scaled) % asset.points.length;
  const nextIndex = (index + 1) % asset.points.length;
  const t = scaled - Math.floor(scaled);
  const a = asset.points[index];
  const b = asset.points[nextIndex];
  const aFallback = sampleTrack(a.progress, a.laneOffset);
  const bFallback = sampleTrack(b.progress, b.laneOffset);
  const aPose = {
    x: a.worldX ?? aFallback.x,
    y: a.worldY ?? aFallback.y,
  };
  const bPose = {
    x: b.worldX ?? bFallback.x,
    y: b.worldY ?? bFallback.y,
  };
  const aCentre = sampleTrack(a.progress);
  const bCentre = sampleTrack(b.progress);
  const aBodyHeading = a.bodyHeading ?? (a.headingOffset === undefined
    ? undefined
    : wrapAngle(aCentre.heading + a.headingOffset));
  const bBodyHeading = b.bodyHeading ?? (b.headingOffset === undefined
    ? undefined
    : wrapAngle(bCentre.heading + b.headingOffset));
  const geometricHeading = Math.atan2(bPose.y - aPose.y, bPose.x - aPose.x);
  const demonstratedHeading = interpolateOptionalAngle(
    aBodyHeading,
    bBodyHeading,
    t,
  );

  return {
    x: lerp(aPose.x, bPose.x, t),
    y: lerp(aPose.y, bPose.y, t),
    heading: demonstratedHeading ?? geometricHeading,
    laneOffset: lerp(a.laneOffset, b.laneOffset, t),
    targetSpeed: lerp(a.targetSpeed, b.targetSpeed, t),
    demonstratedHeading,
  };
}

export interface RuntimeRacingLineProjection {
  progress: number;
  distance: number;
}

/**
 * Project a physical car onto the active explicit path itself, rather than
 * assuming centreline progress is also the correct phase of a PLAYER/EDITOR
 * trajectory. That assumption breaks down badly when an edge-hugging line
 * crosses from one side of a chicane to the other.
 */
export function projectRuntimeRacingLineNear(
  trackId: TrackId,
  x: number,
  y: number,
  referenceProgress: number,
): RuntimeRacingLineProjection {
  const asset = active.get(trackId);
  if (!asset || (asset.source !== 'PLAYER' && asset.source !== 'EDITOR') || asset.points.length === 0) {
    return { progress: wrap01(referenceProgress), distance: Number.POSITIVE_INFINITY };
  }

  const span = clamp(72 / Math.max(1, TRACK_LENGTH), 0.028, 0.075);
  const coarseSteps = 40;
  let bestProgress = wrap01(referenceProgress);
  let bestScore = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index <= coarseSteps; index++) {
    const offset = -span + (2 * span * index) / coarseSteps;
    const progress = wrap01(referenceProgress + offset);
    const point = sampleRuntimeRacingLinePose(trackId, progress);
    const distance = Math.hypot(x - point.x, y - point.y);
    // Keep continuity as a weak tie-breaker only. Geometry should own the
    // projection, but nearby parallel pieces of the miniature circuit must not
    // cause a phase jump to another part of the lap.
    const alongPenalty = Math.abs(offset) * TRACK_LENGTH * 0.035;
    const score = distance + alongPenalty;
    if (score < bestScore) {
      bestScore = score;
      bestDistance = distance;
      bestProgress = progress;
    }
  }

  let step = (2 * span) / coarseSteps;
  for (let pass = 0; pass < 4; pass++) {
    let refinedProgress = bestProgress;
    let refinedScore = bestScore;
    let refinedDistance = bestDistance;
    for (const direction of [-1, 0, 1] as const) {
      const progress = wrap01(bestProgress + direction * step);
      const point = sampleRuntimeRacingLinePose(trackId, progress);
      const distance = Math.hypot(x - point.x, y - point.y);
      const phaseDelta = circularProgressDistance(progress, referenceProgress);
      const score = distance + phaseDelta * TRACK_LENGTH * 0.035;
      if (score < refinedScore) {
        refinedScore = score;
        refinedDistance = distance;
        refinedProgress = progress;
      }
    }
    bestProgress = refinedProgress;
    bestScore = refinedScore;
    bestDistance = refinedDistance;
    step *= 0.5;
  }

  return { progress: bestProgress, distance: bestDistance };
}

/**
 * Derive feed-forward braking from the selected explicit speed trace.
 *
 * PLAYER/EDITOR assets deliberately do not copy pedal input. Instead we scan
 * far enough ahead for the current speed and real braking authority, then ask
 * how much deceleration is required to arrive at every future target speed.
 * This produces a physical deceleration envelope rather than waiting for the
 * generic speed controller to discover a sharp speed drop after it is too late.
 */
export function racingLineBrakeIntent(
  trackId: TrackId,
  progress: number,
  tireGrip: number,
  currentSpeed: number,
): number {
  const asset = active.get(trackId);
  if (!asset || (asset.source !== 'PLAYER' && asset.source !== 'EDITOR')) return 0;

  const fullBrake = controlArcadeCar(
    { vx: currentSpeed, vy: 0, heading: 0, angularVelocity: 0 },
    {
      throttle: 0,
      brake: 1,
      steer: 0,
      tireGrip,
      powerBoost: REFERENCE_POWER_BOOST,
    },
    1 / 120,
  );
  const availableDeceleration = Math.max(8, -fullBrake.acceleration);

  // Look far enough ahead to decelerate from the current speed toward the
  // controller's minimum racing speed without requiring an emergency stop.
  // The cap keeps this cheap and prevents a distant slow corner from affecting
  // an unrelated part of the lap.
  const planningDeceleration = availableDeceleration * 0.55;
  const floorSpeed = 26;
  const physicalHorizon = planningDeceleration > 0
    ? (currentSpeed * currentSpeed - floorSpeed * floorSpeed) / (2 * planningDeceleration)
    : MIN_BRAKE_LOOKAHEAD_METRES;
  const horizon = clamp(
    physicalHorizon + BRAKE_LOOKAHEAD_STEP_METRES,
    MIN_BRAKE_LOOKAHEAD_METRES,
    MAX_BRAKE_LOOKAHEAD_METRES,
  );

  let intent = 0;
  for (
    let distance = BRAKE_LOOKAHEAD_STEP_METRES;
    distance <= horizon;
    distance += BRAKE_LOOKAHEAD_STEP_METRES
  ) {
    const futureSpeed = activeReferenceTarget(
      trackId,
      progress + distance / TRACK_LENGTH,
      tireGrip,
    ).targetSpeed;
    if (currentSpeed <= futureSpeed + 0.35) continue;

    const requiredDeceleration = Math.max(
      0,
      (currentSpeed * currentSpeed - futureSpeed * futureSpeed) / (2 * distance),
    );
    intent = Math.max(
      intent,
      clamp((requiredDeceleration / availableDeceleration - 0.025) * 1.12, 0, 1),
    );
  }

  return intent;
}


/**
 * Derive feed-forward throttle from the demonstrated speed trace.
 *
 * PLAYER/EDITOR execution must not inherit AUTO's machine-reference throttle.
 * The speed samples already describe the longitudinal plan, so estimate the
 * acceleration needed over the next short path segment and solve the shared
 * chassis for the throttle that produces it. Feedback in DynamicAiController
 * still corrects any residual speed error.
 */
export function racingLineThrottleIntent(
  trackId: TrackId,
  progress: number,
  tireGrip: number,
  currentSpeed: number,
  steer: number,
): number {
  const asset = active.get(trackId);
  if (!asset || (asset.source !== 'PLAYER' && asset.source !== 'EDITOR')) return 0;

  const distance = 12;
  const currentTarget = activeReferenceTarget(
    trackId,
    progress,
    tireGrip,
  ).targetSpeed;
  const futureTarget = activeReferenceTarget(
    trackId,
    progress + distance / TRACK_LENGTH,
    tireGrip,
  ).targetSpeed;
  const selected = sampleRacingLineAsset(asset, progress);
  const sourceGrip = selected.tireGrip ?? asset.referenceGrip ?? tireGrip;
  const sourceGripMatched = Math.abs(tireGrip - sourceGrip) < 0.015;
  const useForwardAcceleration =
    selected.forwardAcceleration !== undefined && sourceGripMatched;
  const demonstratedAcceleration =
    selected.forwardAcceleration ?? selected.longitudinalAcceleration;
  const desiredAcceleration =
    demonstratedAcceleration !== undefined && sourceGripMatched
      ? demonstratedAcceleration
      : (futureTarget * futureTarget - currentTarget * currentTarget)
        / (2 * distance);

  // forwardAcceleration is captured directly from controlArcadeCar's physical
  // forward-axis result, before Rapier's lateral scrub / linear damping. Solve
  // against that same quantity. Legacy dv/dt traces keep the old net-speed
  // solver so the two meanings are never mixed.
  const accelerationModel = useForwardAcceleration
    ? runtimeForwardAcceleration
    : runtimeLongitudinalAcceleration;
  const coast = accelerationModel(
    currentSpeed,
    tireGrip,
    0,
    0,
    steer,
  );
  const fullThrottle = accelerationModel(
    currentSpeed,
    tireGrip,
    1,
    0,
    steer,
  );
  if (desiredAcceleration <= coast) return 0;

  return clamp(
    (desiredAcceleration - coast)
      / Math.max(0.001, fullThrottle - coast),
    0,
    1,
  );
}

/**
 * Follow the local deceleration already present in a physically demonstrated
 * speed trace. Unlike the legacy long-horizon envelope, this does not brake
 * early for a slow corner that the recorded driver has not started braking for
 * yet; it reproduces the demonstrated speed derivative with the shared chassis.
 */
export function racingLineLocalBrakeIntent(
  trackId: TrackId,
  progress: number,
  tireGrip: number,
  currentSpeed: number,
  steer: number,
): number {
  const asset = active.get(trackId);
  if (!asset || (asset.source !== 'PLAYER' && asset.source !== 'EDITOR')) return 0;

  const distance = 8;
  const currentTarget = activeReferenceTarget(
    trackId,
    progress,
    tireGrip,
  ).targetSpeed;
  const futureTarget = activeReferenceTarget(
    trackId,
    progress + distance / TRACK_LENGTH,
    tireGrip,
  ).targetSpeed;
  // Reproduce the demonstrated local acceleration first. For a modern AXF
  // trace, targetSpeed is a phase guardrail rather than a second longitudinal
  // controller: a few km/h of phase error must not turn a demonstrated positive
  // acceleration into braking. Only a material overspeed beyond the guard band
  // is corrected, and that correction is spread over a long distance. Legacy
  // traces keep the older tight speed correction because they do not carry the
  // stronger forward-axis state signal.
  const selected = sampleRacingLineAsset(asset, progress);
  const sourceGrip = selected.tireGrip ?? asset.referenceGrip ?? tireGrip;
  const sourceGripMatched = Math.abs(tireGrip - sourceGrip) < 0.015;
  const useForwardAcceleration =
    selected.forwardAcceleration !== undefined && sourceGripMatched;
  const demonstratedAcceleration =
    selected.forwardAcceleration ?? selected.longitudinalAcceleration;
  const traceAcceleration =
    demonstratedAcceleration !== undefined && sourceGripMatched
      ? demonstratedAcceleration
      : (futureTarget * futureTarget - currentTarget * currentTarget)
        / (2 * distance);
  // If replay has already fallen materially below the demonstrated speed,
  // reproducing a negative AXF would deepen the deficit. In that state speed
  // becomes the guardrail: release the demonstrated brake and let the chassis
  // recover before resuming the recorded deceleration profile.
  if (
    useForwardAcceleration
    && currentSpeed < currentTarget - AXF_SPEED_GUARD_DEADBAND
    && traceAcceleration < 0
  ) {
    return 0;
  }

  const overspeedCorrection = useForwardAcceleration
    ? currentSpeed > currentTarget + AXF_SPEED_GUARD_DEADBAND
      ? (
          (currentTarget + AXF_SPEED_GUARD_DEADBAND) ** 2
          - currentSpeed * currentSpeed
        ) / (2 * AXF_SPEED_GUARD_CORRECTION_DISTANCE)
      : 0
    : currentSpeed > currentTarget
      ? (currentTarget * currentTarget - currentSpeed * currentSpeed) / (2 * 4)
      : 0;
  const desiredAcceleration = traceAcceleration + overspeedCorrection;

  const accelerationModel = useForwardAcceleration
    ? runtimeForwardAcceleration
    : runtimeLongitudinalAcceleration;
  const coast = accelerationModel(
    currentSpeed,
    tireGrip,
    0,
    0,
    steer,
  );
  if (desiredAcceleration >= coast) return 0;

  const fullBrake = accelerationModel(
    currentSpeed,
    tireGrip,
    0,
    1,
    steer,
  );
  return clamp(
    (coast - desiredAcceleration)
      / Math.max(0.001, coast - fullBrake),
    0,
    1,
  );
}

function runtimeForwardAcceleration(
  speed: number,
  tireGrip: number,
  throttle: number,
  brake: number,
  steer: number,
): number {
  return controlArcadeCar(
    { vx: speed, vy: 0, heading: 0, angularVelocity: 0 },
    {
      throttle,
      brake,
      steer,
      tireGrip,
      powerBoost: REFERENCE_POWER_BOOST,
    },
    1 / 120,
  ).acceleration;
}

function runtimeLongitudinalAcceleration(
  speed: number,
  tireGrip: number,
  throttle: number,
  brake: number,
  steer: number,
): number {
  const dt = 1 / 120;
  const result = controlArcadeCar(
    { vx: speed, vy: 0, heading: 0, angularVelocity: 0 },
    {
      throttle,
      brake,
      steer,
      tireGrip,
      powerBoost: REFERENCE_POWER_BOOST,
    },
    dt,
  );
  const controlledSpeed = Math.hypot(result.vx, result.vy);
  const dampedSpeed = controlledSpeed / (1 + 0.018 * dt);
  return (dampedSpeed - speed) / dt;
}

/**
 * Merge an explicit RacingLineAsset with the existing physics-derived reference.
 *
 * The asset owns line placement and speed intent. The existing reference still
 * supplies curvature/control hints and transfers the recorded speed profile
 * across tyre-grip changes. PLAYER/EDITOR speeds are preserved exactly at the
 * grip at which they were recorded; only the tyre-grip transfer factor is
 * bounded, rather than clipping the demonstrated speed trace itself.
 */
export function activeReferenceTarget(
  trackId: TrackId,
  progress: number,
  tireGrip: number,
): ReferenceLapSample {
  const fallback = referenceTarget(trackId, progress, tireGrip);
  const asset = active.get(trackId);
  if (!asset || asset.points.length === 0) return fallback;

  const selected = sampleRacingLineAsset(asset, progress);
  const sourceGrip = selected.tireGrip ?? asset.referenceGrip ?? tireGrip;
  const sourceReference = referenceTarget(trackId, progress, sourceGrip);
  const gripTransfer = sourceReference.targetSpeed > 1
    ? fallback.targetSpeed / sourceReference.targetSpeed
    : 1;

  return {
    ...fallback,
    laneOffset: selected.laneOffset,
    targetSpeed: selected.targetSpeed * clamp(gripTransfer, 0.72, 1.18),
  };
}


function interpolateOptionalAngle(
  a: number | undefined,
  b: number | undefined,
  t: number,
): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined) return b;
  if (b === undefined) return a;
  return wrapAngle(a + wrapAngle(b - a) * t);
}

function wrapAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

function circularProgressDistance(a: number, b: number): number {
  const delta = Math.abs(wrap01(a - b));
  return Math.min(delta, 1 - delta);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
