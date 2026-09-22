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
    const selected = sampleRacingLineAsset(asset, progress);
    const point = sampleTrack(progress, selected.laneOffset);
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
      const selected = sampleRacingLineAsset(asset, progress);
      const point = sampleTrack(progress, selected.laneOffset);
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
  const sourceGrip = asset.referenceGrip ?? tireGrip;
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
