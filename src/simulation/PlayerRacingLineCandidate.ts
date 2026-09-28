import type {
  RacingLineAsset,
  RacingLinePoint,
} from './RacingLineAsset';
import {
  sampleTrack,
  samplesForDistance,
  trackLengthFor,
  type TrackId,
} from './TrackModel';

const MIN_SAMPLE_COUNT = 320;
const SAMPLE_SPACING_METRES = 7;
const STORAGE_KEY = 'pitwall-racer:racing-line-candidates:v1';

interface RawSample {
  progress: number;
  laneOffset: number;
  speed: number;
  worldX: number;
  worldY: number;
  bodyHeading?: number;
  headingOffset?: number;
  yawRate?: number;
  longitudinalAcceleration?: number;
  tireGrip?: number;
  forwardAcceleration?: number;
}

interface CandidateStore {
  version: 1;
  candidates: Partial<Record<TrackId, RacingLineAsset>>;
}

export interface RacingLineCandidateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Records one clean player lap and converts it into the exact same conceptual
 * asset the CPU will eventually consume: progress, lane offset and target
 * speed. Player controls are deliberately not copied.
 */
export class PlayerRacingLineCandidateRecorder {
  private trackId?: TrackId;
  private referenceGrip?: number;
  private samples: RawSample[] = [];
  private lastProgress?: number;
  private wrapped = false;
  private eligible = true;

  begin(trackId: TrackId, referenceGrip?: number): void {
    this.trackId = trackId;
    this.referenceGrip = referenceGrip;
    this.samples = [];
    this.lastProgress = undefined;
    this.wrapped = false;
    this.eligible = true;
  }

  sample(
    progress: number,
    laneOffset: number,
    speed: number,
    headingOffset?: number,
    yawRate?: number,
    dt?: number,
    tireGrip?: number,
    forwardAcceleration?: number,
  ): void {
    if (!this.trackId || this.wrapped) return;
    const p = wrap01(progress);

    if (
      this.lastProgress !== undefined
      && this.lastProgress > 0.85
      && p < 0.15
    ) {
      this.wrapped = true;
      return;
    }

    const safeSpeed = Math.max(0, speed);
    const pathPose = sampleTrack(p, laneOffset);
    const centrePose = sampleTrack(p);
    const bodyHeading = Number.isFinite(headingOffset)
      ? wrapAngle(centrePose.heading + (headingOffset ?? 0))
      : undefined;
    const previous = this.samples[this.samples.length - 1];
    const longitudinalAcceleration = previous && dt !== undefined && dt > 0
      ? clamp((safeSpeed - previous.speed) / dt, -45, 22)
      : undefined;
    this.samples.push({
      progress: p,
      laneOffset,
      speed: safeSpeed,
      worldX: pathPose.x,
      worldY: pathPose.y,
      bodyHeading,
      headingOffset: Number.isFinite(headingOffset) ? headingOffset : undefined,
      yawRate: Number.isFinite(yawRate) ? yawRate : undefined,
      longitudinalAcceleration,
      tireGrip: Number.isFinite(tireGrip) ? tireGrip : undefined,
      forwardAcceleration: Number.isFinite(forwardAcceleration)
        ? forwardAcceleration
        : undefined,
    });
    this.lastProgress = p;
  }

  markIneligible(): void {
    this.eligible = false;
  }

  finish(lapSeconds: number): RacingLineAsset | undefined {
    if (!this.trackId || !this.eligible) return undefined;
    if (!Number.isFinite(lapSeconds) || lapSeconds <= 0) return undefined;
    if (this.samples.length < 120) return undefined;

    const ordered = [...this.samples].sort((a, b) => a.progress - b.progress);
    if (ordered[0].progress > 0.06 || ordered[ordered.length - 1].progress < 0.94) {
      return undefined;
    }

    const sampleCount = samplesForDistance(
      trackLengthFor(this.trackId),
      SAMPLE_SPACING_METRES,
      MIN_SAMPLE_COUNT,
      1600,
    );
    const points: RacingLinePoint[] = Array.from(
      { length: sampleCount },
      (_, index) => interpolateSample(ordered, index / sampleCount, sampleCount),
    );

    return {
      version: 1,
      trackId: this.trackId,
      source: 'PLAYER',
      referenceGrip: this.referenceGrip,
      lapSeconds,
      points,
    };
  }
}

export function racingLineTraceQuality(
  asset: RacingLineAsset | undefined,
): number {
  if (!asset) return -1;
  const points = asset.points;
  if (points.some((point) =>
    point.forwardAcceleration !== undefined
    && point.worldX !== undefined
    && point.worldY !== undefined
    && point.bodyHeading !== undefined
  )) return 5;
  if (points.some((point) => point.forwardAcceleration !== undefined)) return 4;
  if (points.some((point) => point.tireGrip !== undefined)) return 3;
  if (points.some((point) => point.longitudinalAcceleration !== undefined)) return 2;
  if (points.some(
    (point) => point.headingOffset !== undefined && point.yawRate !== undefined,
  )) return 1;
  return 0;
}

export function saveBestPlayerRacingLineCandidate(
  storage: RacingLineCandidateStorage,
  candidate: RacingLineAsset,
): RacingLineAsset {
  const store = loadStore(storage);
  const previous = store.candidates[candidate.trackId];

  if (previous) {
    const previousQuality = racingLineTraceQuality(previous);
    const candidateQuality = racingLineTraceQuality(candidate);

    // Never trade replay fidelity for a headline lap time. Once a trace has
    // richer physical state (heading/yaw, acceleration, grip, AXF), a lower
    // fidelity race lap must not overwrite it even if that lap was faster.
    if (candidateQuality < previousQuality) return previous;

    // A richer trace is an upgrade even if slightly slower. At equal quality,
    // preserve the fastest clean demonstrated lap.
    if (
      candidateQuality === previousQuality
      && previous.lapSeconds !== undefined
      && candidate.lapSeconds !== undefined
      && previous.lapSeconds <= candidate.lapSeconds
    ) {
      return previous;
    }
  }

  store.candidates[candidate.trackId] = candidate;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // A development aid must never break the playable race loop.
  }
  return candidate;
}

export function loadPlayerRacingLineCandidate(
  storage: RacingLineCandidateStorage,
  trackId: TrackId,
): RacingLineAsset | undefined {
  return loadStore(storage).candidates[trackId];
}

function loadStore(storage: RacingLineCandidateStorage): CandidateStore {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, candidates: {} };
    const parsed = JSON.parse(raw) as Partial<CandidateStore>;
    if (parsed.version !== 1 || !parsed.candidates) {
      return { version: 1, candidates: {} };
    }
    return {
      version: 1,
      candidates: parsed.candidates,
    };
  } catch {
    return { version: 1, candidates: {} };
  }
}

function interpolateSample(
  samples: readonly RawSample[],
  progress: number,
  outputSampleCount = MIN_SAMPLE_COUNT,
): RacingLinePoint {
  let high = 0;
  while (high < samples.length && samples[high].progress < progress) high += 1;

  let a: RawSample;
  let b: RawSample;
  let sampleProgress = progress;

  if (high <= 0) {
    // A lap is circular. Interpolate across the start/finish seam instead of
    // extending the first observed sample backwards to progress 0. That old
    // edge hold introduced a small but sharp path/rotation discontinuity at
    // the line, which became visible as a multi-metre replay spike.
    const last = samples[samples.length - 1];
    const first = samples[0];
    a = { ...last, progress: last.progress - 1 };
    b = first;
  } else if (high >= samples.length) {
    const last = samples[samples.length - 1];
    const first = samples[0];
    a = last;
    b = { ...first, progress: first.progress + 1 };
    if (sampleProgress < a.progress) sampleProgress += 1;
  } else {
    a = samples[high - 1];
    b = samples[high];
  }

  const span = Math.max(0.000001, b.progress - a.progress);
  const t = (sampleProgress - a.progress) / span;
  const centre = sampleTrack(progress);
  // Missing start/finish samples must follow the intervening road arc. A
  // world-space chord across a sparse wrap cuts the final corner and becomes
  // a bogus target after uniform resampling hides the original sample gap.
  const sparseWrap = (a.progress < 0 || b.progress >= 1)
    && span > 2 / Math.max(1, outputSampleCount);
  const bridge = sparseWrap ? sampleTrack(progress, lerp(a.laneOffset, b.laneOffset, t * t * (3 - 2 * t))) : undefined;
  const worldX = bridge?.x ?? lerp(a.worldX, b.worldX, t);
  const worldY = bridge?.y ?? lerp(a.worldY, b.worldY, t);
  const bridgeHeading = interpolateOptionalAngle(a.headingOffset, b.headingOffset, t);
  const bodyHeading = sparseWrap && bridgeHeading !== undefined
    ? wrapAngle(centre.heading + bridgeHeading)
    : interpolateOptionalAngle(a.bodyHeading, b.bodyHeading, t);
  const nx = -Math.sin(centre.heading);
  const ny = Math.cos(centre.heading);
  const laneOffset = (worldX - centre.x) * nx + (worldY - centre.y) * ny;
  const headingOffset = bodyHeading === undefined
    ? interpolateOptionalAngle(a.headingOffset, b.headingOffset, t)
    : wrapAngle(bodyHeading - centre.heading);
  return {
    progress,
    laneOffset,
    targetSpeed: lerp(a.speed, b.speed, t),
    worldX,
    worldY,
    bodyHeading,
    headingOffset,
    yawRate: interpolateOptional(a.yawRate, b.yawRate, t),
    longitudinalAcceleration: interpolateOptional(
      a.longitudinalAcceleration,
      b.longitudinalAcceleration,
      t,
    ),
    tireGrip: interpolateOptional(a.tireGrip, b.tireGrip, t),
    forwardAcceleration: interpolateOptional(
      a.forwardAcceleration,
      b.forwardAcceleration,
      t,
    ),
  };
}

function interpolateOptional(
  a: number | undefined,
  b: number | undefined,
  t: number,
): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined) return b;
  if (b === undefined) return a;
  return lerp(a, b, t);
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

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}


function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
