import { controlArcadeCar } from './ArcadeCarController';
import { FREE_KERB_DISTANCE } from './TrackLimitsModel';
import { getTrackDefinition, type TrackId, type TrackPoint } from './TrackModel';

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
 * The perfect driver is allowed to use the legal kerb, but keeps the whole car
 * inside the no-deep-cut envelope. This is intentionally a little wider than
 * the normal AI safety line: the reference should describe the car's limit,
 * not the comfort margin used in traffic.
 */
export const REFERENCE_LANE_LIMIT = FREE_KERB_DISTANCE - 2.4;

const PLAN_SAMPLES = 320;
const CENTRELINE_SAMPLES_PER_CONTROL = 28;
const GRIP_BUCKET = 0.025;
const OPTIMIZER_KNOTS = 48;
const OPTIMIZER_GRIP = 1.30;
const OPTIMIZER_STEPS = [6.0, 3.0, 1.5, 0.75] as const;
const cache = new Map<string, ReferenceLap>();
const optimizedLaneCache = new Map<TrackId, readonly number[]>();

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
 * Convert the old opaque skill number into an execution percentage of the
 * machine-limit reference. Nobody gets extra power or grip: the difference is
 * how closely the driver follows the reference braking/line/speed plan.
 */
export function referenceExecutionForSkill(skill: number): number {
  return clamp(0.988 + (skill - 1.127) * 0.55, 0.982, 0.995);
}

/**
 * Build a deterministic, player-independent machine-limit lap.
 *
 * V2 does not accept the first geometric racing line as truth. It starts from
 * that line, then repeatedly perturbs a set of lane-control knots and keeps a
 * change only when the same vehicle acceleration/braking/yaw equations produce
 * a faster legal lap. In other words, the line itself is optimized against the
 * car rather than copied from a human lap or hand-authored target time.
 */
export function referenceLap(trackId: TrackId, tireGrip: number): ReferenceLap {
  const safeGrip = clamp(tireGrip, 0.55, 1.36);
  const bucketedGrip = Math.round(safeGrip / GRIP_BUCKET) * GRIP_BUCKET;
  const key = `${trackId}:${bucketedGrip.toFixed(3)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const geometry = buildGeometry(getTrackDefinition(trackId).controls);
  const lanes = optimizedReferenceLanes(trackId, geometry);
  const envelope = evaluateLanes(geometry, lanes, bucketedGrip, 10);
  const controls = controlTrace(
    envelope.speeds,
    envelope.curvature,
    envelope.segmentLengths,
    bucketedGrip,
  );

  const samples: ReferenceLapSample[] = envelope.speeds.map((targetSpeed, index) => ({
    progress: index / PLAN_SAMPLES,
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

function optimizedReferenceLanes(trackId: TrackId, geometry: Geometry): readonly number[] {
  const cached = optimizedLaneCache.get(trackId);
  if (cached) return cached;

  const heuristic = Array.from({ length: PLAN_SAMPLES }, (_, index) => (
    rawReferenceLane(geometry, index / PLAN_SAMPLES)
  )).map((_, index, values) => smoothCircular(values, index));

  let knots = Array.from({ length: OPTIMIZER_KNOTS }, (_, knot) => {
    const index = Math.round(knot * PLAN_SAMPLES / OPTIMIZER_KNOTS) % PLAN_SAMPLES;
    return heuristic[index];
  });

  let lanes = lanesFromKnots(knots);
  let bestSeconds = evaluateLanes(geometry, lanes, OPTIMIZER_GRIP, 5).lapSeconds;

  // A centreline seed is worth testing as well: on closely linked corners the
  // old outside-apex-outside heuristic can commit to the wrong side too early.
  const centreKnots = new Array<number>(OPTIMIZER_KNOTS).fill(0);
  const centreLanes = lanesFromKnots(centreKnots);
  const centreSeconds = evaluateLanes(geometry, centreLanes, OPTIMIZER_GRIP, 5).lapSeconds;
  if (centreSeconds < bestSeconds) {
    knots = centreKnots;
    lanes = centreLanes;
    bestSeconds = centreSeconds;
  }

  // Deterministic coordinate descent. Each candidate is a complete legal lap,
  // not a local corner score. That lets the optimizer sacrifice one apex when
  // doing so improves the following braking/acceleration sequence.
  for (const step of OPTIMIZER_STEPS) {
    for (let knot = 0; knot < OPTIMIZER_KNOTS; knot++) {
      const original = knots[knot];
      let chosen = original;
      let chosenSeconds = bestSeconds;

      for (const direction of [-1, 1] as const) {
        const candidateValue = clamp(original + direction * step, -REFERENCE_LANE_LIMIT, REFERENCE_LANE_LIMIT);
        if (Math.abs(candidateValue - original) < 0.001) continue;
        const candidateKnots = [...knots];
        candidateKnots[knot] = candidateValue;
        const candidateLanes = lanesFromKnots(candidateKnots);
        const candidateSeconds = evaluateLanes(geometry, candidateLanes, OPTIMIZER_GRIP, 5).lapSeconds;
        if (candidateSeconds < chosenSeconds - 0.0005) {
          chosen = candidateValue;
          chosenSeconds = candidateSeconds;
        }
      }

      if (chosen !== original) {
        knots[knot] = chosen;
        lanes = lanesFromKnots(knots);
        bestSeconds = chosenSeconds;
      }
    }
  }

  // One gentle sample-space smoothing pass removes sub-car-width optimizer
  // ripples without erasing the deliberately asymmetric line it discovered.
  const optimized = lanes.map((_, index) => smoothCircular(lanes, index));
  optimizedLaneCache.set(trackId, optimized);
  return optimized;
}

function lanesFromKnots(knots: readonly number[]): number[] {
  return Array.from({ length: PLAN_SAMPLES }, (_, index) => {
    const position = index * knots.length / PLAN_SAMPLES;
    const aIndex = Math.floor(position) % knots.length;
    const bIndex = (aIndex + 1) % knots.length;
    const t = position - Math.floor(position);
    const eased = t * t * (3 - 2 * t);
    return clamp(lerp(knots[aIndex], knots[bIndex], eased), -REFERENCE_LANE_LIMIT, REFERENCE_LANE_LIMIT);
  });
}

function evaluateLanes(
  geometry: Geometry,
  lanes: readonly number[],
  tireGrip: number,
  passes: number,
): EnvelopeResult {
  const points = lanes.map((laneOffset, index) => sampleGeometry(
    geometry,
    index / PLAN_SAMPLES,
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
    for (let i = 0; i < PLAN_SAMPLES; i++) {
      const next = (i + 1) % PLAN_SAMPLES;
      const ds = segmentLengths[i];
      const steerDemand = steeringDemand(speeds[i], curvature[i], tireGrip);
      const acceleration = Math.max(0, longitudinalAcceleration(
        speeds[i],
        tireGrip,
        1,
        0,
        steerDemand,
      ));
      const reachable = Math.sqrt(Math.max(0, speeds[i] * speeds[i] + 2 * acceleration * ds));
      speeds[next] = Math.min(speeds[next], localLimits[next], reachable);
    }

    for (let i = PLAN_SAMPLES - 1; i >= 0; i--) {
      const next = (i + 1) % PLAN_SAMPLES;
      const ds = segmentLengths[i];
      const probeSpeed = Math.max(speeds[i], speeds[next]);
      const steerDemand = steeringDemand(probeSpeed, curvature[i], tireGrip);
      const braking = Math.max(1, -longitudinalAcceleration(
        probeSpeed,
        tireGrip,
        0,
        1,
        steerDemand,
      ));
      const allowedEntry = Math.sqrt(Math.max(0, speeds[next] * speeds[next] + 2 * braking * ds));
      speeds[i] = Math.min(speeds[i], localLimits[i], allowedEntry);
    }
  }

  let lapSeconds = 0;
  for (let i = 0; i < PLAN_SAMPLES; i++) {
    const next = (i + 1) % PLAN_SAMPLES;
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
  return speeds.map((speed, index) => {
    const next = (index + 1) % PLAN_SAMPLES;
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

function rawReferenceLane(geometry: Geometry, progress: number): number {
  const local = signedHeadingDelta(geometry, progress - 18 / geometry.length, progress + 18 / geometry.length);
  const upcoming = signedHeadingDelta(geometry, progress + 20 / geometry.length, progress + 92 / geometry.length);
  const previous = signedHeadingDelta(geometry, progress - 92 / geometry.length, progress - 20 / geometry.length);

  const localStrength = clamp01(Math.abs(local) / 0.34);
  const upcomingStrength = clamp01(Math.abs(upcoming) / 0.72);
  const previousStrength = clamp01(Math.abs(previous) / 0.72);

  const apexWeight = smoothstep01((localStrength - 0.06) / 0.72);
  const approachWeight = smoothstep01((upcomingStrength - 0.08) / 0.68) * (1 - apexWeight * 0.82);
  const exitWeight = smoothstep01((previousStrength - 0.08) / 0.68) * (1 - apexWeight * 0.86);

  const apex = Math.abs(local) < 0.012
    ? 0
    : Math.sign(local) * Math.min(REFERENCE_LANE_LIMIT, 5.0 + localStrength * 10.2);
  const approach = Math.abs(upcoming) < 0.016
    ? 0
    : -Math.sign(upcoming) * Math.min(REFERENCE_LANE_LIMIT, 5.4 + upcomingStrength * 9.6);
  const exit = Math.abs(previous) < 0.016
    ? 0
    : -Math.sign(previous) * Math.min(REFERENCE_LANE_LIMIT, 4.6 + previousStrength * 8.8);

  const total = apexWeight + approachWeight + exitWeight;
  if (total < 0.02) return 0;
  return clamp((apex * apexWeight + approach * approachWeight + exit * exitWeight) / total,
    -REFERENCE_LANE_LIMIT,
    REFERENCE_LANE_LIMIT);
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
  const pedalStates = [
    { throttle: 1, brake: 0 },
    { throttle: 0.45, brake: 0 },
    { throttle: 0, brake: 0 },
    { throttle: 0, brake: 0.18 },
  ] as const;
  let best = 0;
  for (const state of pedalStates) {
    const result = controlArcadeCar(
      { vx: speed, vy: 0, heading: 0, angularVelocity: 0 },
      {
        throttle: state.throttle,
        brake: state.brake,
        steer: 1,
        tireGrip,
        powerBoost: REFERENCE_POWER_BOOST,
      },
      10,
    );
    best = Math.max(best, Math.abs(result.angularVelocity));
  }
  return best;
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

function buildGeometry(controls: readonly TrackPoint[]): Geometry {
  const points = buildClosedCatmullRom(controls, CENTRELINE_SAMPLES_PER_CONTROL);
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

function signedHeadingDelta(geometry: Geometry, from: number, to: number): number {
  let delta = sampleGeometry(geometry, to).heading - sampleGeometry(geometry, from).heading;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
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

function smoothCircular(values: readonly number[], index: number): number {
  const weights = [1, 2, 4, 6, 4, 2, 1] as const;
  let sum = 0;
  let total = 0;
  for (let offset = -3; offset <= 3; offset++) {
    const source = (index + offset + values.length) % values.length;
    const weight = weights[offset + 3];
    sum += values[source] * weight;
    total += weight;
  }
  return clamp(sum / total, -REFERENCE_LANE_LIMIT, REFERENCE_LANE_LIMIT);
}

function buildClosedCatmullRom(points: readonly TrackPoint[], samplesPerControl: number): TrackPoint[] {
  const result: TrackPoint[] = [];
  const count = points.length;
  for (let i = 0; i < count; i++) {
    const p0 = points[(i - 1 + count) % count];
    const p1 = points[i];
    const p2 = points[(i + 1) % count];
    const p3 = points[(i + 2) % count];
    for (let sample = 0; sample < samplesPerControl; sample++) {
      const t = sample / samplesPerControl;
      const t2 = t * t;
      const t3 = t2 * t;
      result.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return result;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
