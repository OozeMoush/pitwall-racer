import { controlArcadeCar } from './ArcadeCarController';
import type { RacingLineAsset } from './RacingLineAsset';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';
import { FREE_KERB_DISTANCE } from './TrackLimitsModel';
import {
  getTrackDefinition,
  samplesForDistance,
  trackCentreline,
  trackGeometryRevision,
  type TrackId,
  type TrackPoint,
} from './TrackModel';

export interface ReferenceLapSample {
  progress: number;
  laneOffset: number;
  targetSpeed: number;
  curvature: number;
  throttle: number;
  brake: number;
}

export interface ReferenceLap {
  trackId: TrackId;
  tireGrip: number;
  lapSeconds: number;
  straightLimit: number;
  samples: readonly ReferenceLapSample[];
}

/** Same baseline propulsion used by the player in qualifying/race physics. */
export const REFERENCE_POWER_BOOST = 0.22;

/**
 * The perfect driver may use the legal kerb, but keeps the whole car inside
 * the no-deep-cut envelope. The offline trajectory optimizer was constrained
 * to this same limit.
 */
export const REFERENCE_LANE_LIMIT = FREE_KERB_DISTANCE - 2.4;

const MIN_PLAN_SAMPLES = 320;
const PLAN_SAMPLE_SPACING_METRES = 7;
const GRIP_BUCKET = 0.025;
const PHYSICS_STEP_SECONDS = 1 / 120;

// Rapier applies damping after the controller writes each velocity. These are
// the exact body settings used by RapierRacePhysics.createDynamicCar(). The
// reference solver must include them or it invents a 423 km/h car that the
// actual rigid body can never reproduce.
const RAPIER_LINEAR_DAMPING = 0.018;
const RAPIER_ANGULAR_DAMPING = 1.05;

const cache = new Map<string, ReferenceLap>();
const maximumYawCache = new Map<string, number>();

interface Segment {
  a: TrackPoint;
  b: TrackPoint;
  length: number;
  start: number;
}

interface Geometry {
  segments: readonly Segment[];
  length: number;
}

interface EnvelopeResult {
  curvature: number[];
  segmentLengths: number[];
  speeds: number[];
  lapSeconds: number;
  straightLimit: number;
}

/**
 * Build the player-independent machine-limit lap.
 *
 * The lane trajectory is the deterministic result of an offline whole-lap
 * coordinate-descent optimizer. Every candidate was legal and was scored with
 * these same vehicle acceleration/braking/yaw equations. Baking the resulting
 * path keeps gameplay instantaneous; tyre-specific speed and control envelopes
 * are still recomputed from the actual car physics, never from a human lap.
 */
export function referenceLap(trackId: TrackId, tireGrip: number): ReferenceLap {
  const safeGrip = clamp(tireGrip, 0.55, 1.36);
  const bucketedGrip = Math.round(safeGrip / GRIP_BUCKET) * GRIP_BUCKET;
  const key = `${trackId}:${trackGeometryRevision(trackId)}:${bucketedGrip.toFixed(3)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const geometry = buildGeometry(trackCentreline(trackId));
  // Keep the compact 320-point baseline on today's short circuits, then grow
  // resolution by physical distance so 5–7 km layouts do not degrade into
  // 15–20 m reference chunks.
  const planSamples = samplesForDistance(
    geometry.length,
    PLAN_SAMPLE_SPACING_METRES,
    MIN_PLAN_SAMPLES,
    1600,
  );
  const laneSource = getTrackDefinition(trackId).referenceLaneMode === 'centerline'
    ? [0]
    : OPTIMIZED_REFERENCE_LANES[trackId];
  const lanes = resampleCircular(laneSource, planSamples);

  const envelope = evaluateLanes(geometry, lanes, bucketedGrip, 10);
  const controls = controlTrace(
    envelope.speeds,
    envelope.curvature,
    envelope.segmentLengths,
    bucketedGrip,
  );

  const samples: ReferenceLapSample[] = envelope.speeds.map((targetSpeed, index) => ({
    progress: index / planSamples,
    laneOffset: lanes[index],
    targetSpeed,
    curvature: envelope.curvature[index],
    throttle: controls[index].throttle,
    brake: controls[index].brake,
  }));

  const lap: ReferenceLap = {
    trackId,
    tireGrip: bucketedGrip,
    lapSeconds: envelope.lapSeconds,
    straightLimit: envelope.straightLimit,
    samples,
  };
  cache.set(key, lap);
  return lap;
}

export function referenceRacingLineAsset(
  trackId: TrackId,
  tireGrip: number,
): RacingLineAsset {
  const lap = referenceLap(trackId, tireGrip);
  const geometry = buildGeometry(trackCentreline(trackId));
  const points = lap.samples.map((sample, index) => {
    const previous = lap.samples[(index - 1 + lap.samples.length) % lap.samples.length];
    const next = lap.samples[(index + 1) % lap.samples.length];
    const previousPoint = sampleGeometry(geometry, previous.progress, previous.laneOffset);
    const currentPoint = sampleGeometry(geometry, sample.progress, sample.laneOffset);
    const nextPoint = sampleGeometry(geometry, next.progress, next.laneOffset);
    const pathHeading = Math.atan2(
      nextPoint.y - previousPoint.y,
      nextPoint.x - previousPoint.x,
    );
    const centreHeading = sampleGeometry(geometry, sample.progress, 0).heading;
    const signedCurvature = signedPathCurvature(
      previousPoint,
      currentPoint,
      nextPoint,
    );

    return {
      progress: sample.progress,
      laneOffset: sample.laneOffset,
      targetSpeed: sample.targetSpeed,
      headingOffset: wrapAngle(pathHeading - centreHeading),
      yawRate: sample.targetSpeed * signedCurvature,
    };
  });

  return {
    version: 1,
    trackId,
    source: 'OPTIMIZER',
    referenceGrip: lap.tireGrip,
    lapSeconds: lap.lapSeconds,
    points,
  };
}

export function referenceTarget(
  trackId: TrackId,
  progress: number,
  tireGrip: number,
): ReferenceLapSample {
  const lap = referenceLap(trackId, tireGrip);
  const p = ((progress % 1) + 1) % 1;
  const scaled = p * lap.samples.length;
  const index = Math.floor(scaled) % lap.samples.length;
  const nextIndex = (index + 1) % lap.samples.length;
  const t = scaled - Math.floor(scaled);
  const a = lap.samples[index];
  const b = lap.samples[nextIndex];
  return {
    progress: p,
    laneOffset: lerp(a.laneOffset, b.laneOffset, t),
    targetSpeed: lerp(a.targetSpeed, b.targetSpeed, t),
    curvature: lerp(a.curvature, b.curvature, t),
    throttle: lerp(a.throttle, b.throttle, t),
    brake: lerp(a.brake, b.brake, t),
  };
}

function resampleCircular(values: readonly number[], count: number): number[] {
  if (values.length === 0) return new Array<number>(count).fill(0);
  if (values.length === count) return [...values];
  return Array.from({ length: count }, (_, index) => {
    const position = index * values.length / count;
    const aIndex = Math.floor(position) % values.length;
    const bIndex = (aIndex + 1) % values.length;
    return lerp(values[aIndex], values[bIndex], position - Math.floor(position));
  });
}

function evaluateLanes(
  geometry: Geometry,
  lanes: readonly number[],
  tireGrip: number,
  passes: number,
): EnvelopeResult {
  const sampleCount = Math.max(1, lanes.length);
  const points = lanes.map((laneOffset, index) => sampleGeometry(
    geometry,
    index / sampleCount,
    laneOffset,
  ));
  const curvature = points.map((_, index) => pathCurvature(points, index));
  const segmentLengths = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return Math.max(0.1, Math.hypot(next.x - point.x, next.y - point.y));
  });

  const straightLimit = solveStraightLimit();
  const localLimits = curvature.map((value) => solveCornerLimit(value, tireGrip, straightLimit));
  const speeds = [...localLimits];

  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < sampleCount; i++) {
      const next = (i + 1) % sampleCount;
      const ds = segmentLengths[i];
      const steerDemand = steeringDemand(speeds[i], curvature[i], tireGrip);
      const acceleration = Math.max(0, longitudinalAcceleration(
        speeds[i], tireGrip, 1, 0, steerDemand,
      ));
      const reachable = Math.sqrt(Math.max(0, speeds[i] * speeds[i] + 2 * acceleration * ds));
      speeds[next] = Math.min(speeds[next], localLimits[next], reachable);
    }

    for (let i = sampleCount - 1; i >= 0; i--) {
      const next = (i + 1) % sampleCount;
      const ds = segmentLengths[i];
      const probeSpeed = Math.max(speeds[i], speeds[next]);
      const steerDemand = steeringDemand(probeSpeed, curvature[i], tireGrip);
      const braking = Math.max(1, -longitudinalAcceleration(
        probeSpeed, tireGrip, 0, 1, steerDemand,
      ));
      const allowedEntry = Math.sqrt(Math.max(0, speeds[next] * speeds[next] + 2 * braking * ds));
      speeds[i] = Math.min(speeds[i], localLimits[i], allowedEntry);
    }
  }

  let lapSeconds = 0;
  for (let i = 0; i < sampleCount; i++) {
    const next = (i + 1) % sampleCount;
    lapSeconds += (2 * segmentLengths[i]) / Math.max(8, speeds[i] + speeds[next]);
  }

  return { curvature, segmentLengths, speeds, lapSeconds, straightLimit };
}

function controlTrace(
  speeds: readonly number[],
  curvature: readonly number[],
  segmentLengths: readonly number[],
  tireGrip: number,
): { throttle: number; brake: number }[] {
  const sampleCount = Math.max(1, speeds.length);
  return speeds.map((speed, index) => {
    const next = (index + 1) % sampleCount;
    const ds = segmentLengths[index];
    const desiredAcceleration = (speeds[next] * speeds[next] - speed * speed) / (2 * ds);
    const steer = steeringDemand(speed, curvature[index], tireGrip);
    const coast = longitudinalAcceleration(speed, tireGrip, 0, 0, steer);

    if (desiredAcceleration >= coast) {
      const fullThrottle = longitudinalAcceleration(speed, tireGrip, 1, 0, steer);
      return {
        throttle: clamp((desiredAcceleration - coast) / Math.max(0.001, fullThrottle - coast), 0, 1),
        brake: 0,
      };
    }

    const fullBrake = longitudinalAcceleration(speed, tireGrip, 0, 1, steer);
    return {
      throttle: 0,
      brake: clamp((coast - desiredAcceleration) / Math.max(0.001, coast - fullBrake), 0, 1),
    };
  });
}

function solveStraightLimit(): number {
  let low = 50;
  let high = 150;
  for (let iteration = 0; iteration < 18; iteration++) {
    const mid = (low + high) / 2;
    const acceleration = longitudinalAcceleration(mid, 1.10, 1, 0, 0);
    if (acceleration > 0) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function solveCornerLimit(curvature: number, tireGrip: number, straightLimit: number): number {
  if (curvature < 0.00035) return straightLimit;
  let low = 12;
  let high = straightLimit;
  for (let iteration = 0; iteration < 13; iteration++) {
    const mid = (low + high) / 2;
    const requiredYaw = mid * curvature;
    const availableYaw = maximumReferenceYaw(mid, tireGrip);
    if (availableYaw >= requiredYaw) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function maximumReferenceYaw(speed: number, tireGrip: number): number {
  const cacheKey = `${Math.round(speed * 4)}:${Math.round(tireGrip * 200)}`;
  const cached = maximumYawCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const pedalStates = [
    { throttle: 1, brake: 0 },
    { throttle: 0.45, brake: 0 },
    { throttle: 0, brake: 0 },
    { throttle: 0, brake: 0.18 },
  ] as const;
  const angularDamping = rapierDampingFactor(RAPIER_ANGULAR_DAMPING, PHYSICS_STEP_SECONDS);
  let best = 0;
  for (const state of pedalStates) {
    let angularVelocity = 0;
    // Converge the same controller + Rapier damping recurrence used by the
    // physical rigid body while holding speed constant for a local corner-limit
    // query. One second is ample for the arcade yaw response to settle.
    for (let step = 0; step < 120; step++) {
      const result = controlArcadeCar(
        { vx: speed, vy: 0, heading: 0, angularVelocity },
        {
          throttle: state.throttle,
          brake: state.brake,
          steer: 1,
          tireGrip,
          powerBoost: REFERENCE_POWER_BOOST,
        },
        PHYSICS_STEP_SECONDS,
      );
      angularVelocity = result.angularVelocity * angularDamping;
    }
    best = Math.max(best, Math.abs(angularVelocity));
  }

  maximumYawCache.set(cacheKey, best);
  return best;
}

export function referenceSteerForCurvature(
  speed: number,
  signedCurvature: number,
  tireGrip: number,
): number {
  if (Math.abs(signedCurvature) < 0.0002 || speed < 1) return 0;
  return Math.sign(signedCurvature)
    * steeringDemand(speed, Math.abs(signedCurvature), tireGrip);
}

function steeringDemand(speed: number, curvature: number, tireGrip: number): number {
  if (curvature < 0.0002 || speed < 1) return 0;
  const available = Math.max(0.0001, maximumReferenceYaw(speed, tireGrip));
  return clamp(speed * curvature / available, 0, 1);
}

function longitudinalAcceleration(
  speed: number,
  tireGrip: number,
  throttle: number,
  brake: number,
  steer: number,
): number {
  const result = controlArcadeCar(
    { vx: speed, vy: 0, heading: 0, angularVelocity: 0 },
    {
      throttle,
      brake,
      steer,
      tireGrip,
      powerBoost: REFERENCE_POWER_BOOST,
    },
    PHYSICS_STEP_SECONDS,
  );
  const controlledSpeed = Math.hypot(result.vx, result.vy);
  const dampedSpeed = controlledSpeed * rapierDampingFactor(
    RAPIER_LINEAR_DAMPING,
    PHYSICS_STEP_SECONDS,
  );
  return (dampedSpeed - speed) / PHYSICS_STEP_SECONDS;
}

function rapierDampingFactor(damping: number, dt: number): number {
  // Rapier uses an implicit first-order damping step, which stays stable even
  // for large coefficients: v' = v / (1 + damping * dt).
  return 1 / (1 + Math.max(0, damping) * Math.max(0, dt));
}

function buildGeometry(points: readonly TrackPoint[]): Geometry {
  const segments: Segment[] = [];
  let length = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
    segments.push({ a, b, length: segmentLength, start: length });
    length += segmentLength;
  }
  return { segments, length };
}

function sampleGeometry(geometry: Geometry, progress: number, laneOffset = 0): TrackPoint & { heading: number } {
  const p = ((progress % 1) + 1) % 1;
  const distance = p * geometry.length;
  let segment = geometry.segments[geometry.segments.length - 1];
  for (const candidate of geometry.segments) {
    if (distance >= candidate.start && distance <= candidate.start + candidate.length) {
      segment = candidate;
      break;
    }
  }
  const t = clamp((distance - segment.start) / Math.max(0.0001, segment.length), 0, 1);
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const heading = Math.atan2(dy, dx);
  const nx = -Math.sin(heading);
  const ny = Math.cos(heading);
  return {
    x: segment.a.x + dx * t + nx * laneOffset,
    y: segment.a.y + dy * t + ny * laneOffset,
    heading,
  };
}

function signedPathCurvature(
  previous: TrackPoint,
  current: TrackPoint,
  next: TrackPoint,
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

function pathCurvature(points: readonly TrackPoint[], index: number): number {
  const previous = points[(index - 1 + points.length) % points.length];
  const current = points[index];
  const next = points[(index + 1) % points.length];
  const ab = Math.hypot(current.x - previous.x, current.y - previous.y);
  const bc = Math.hypot(next.x - current.x, next.y - current.y);
  const ac = Math.hypot(next.x - previous.x, next.y - previous.y);
  const cross = Math.abs(
    (current.x - previous.x) * (next.y - previous.y)
    - (current.y - previous.y) * (next.x - previous.x),
  );
  const denominator = ab * bc * ac;
  if (denominator < 0.0001) return 0;
  return (2 * cross) / denominator;
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
