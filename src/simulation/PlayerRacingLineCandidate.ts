import type {
  RacingLineAsset,
  RacingLinePoint,
} from './RacingLineAsset';
import type { TrackId } from './TrackModel';

const SAMPLE_COUNT = 320;
const STORAGE_KEY = 'pitwall-racer:racing-line-candidates:v1';

interface RawSample {
  progress: number;
  laneOffset: number;
  speed: number;
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
    const previous = this.samples[this.samples.length - 1];
    const longitudinalAcceleration = previous && dt !== undefined && dt > 0
      ? clamp((safeSpeed - previous.speed) / dt, -45, 22)
      : undefined;
    this.samples.push({
      progress: p,
      laneOffset,
      speed: safeSpeed,
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

    const points: RacingLinePoint[] = Array.from(
      { length: SAMPLE_COUNT },
      (_, index) => interpolateSample(ordered, index / SAMPLE_COUNT),
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

export function saveBestPlayerRacingLineCandidate(
  storage: RacingLineCandidateStorage,
  candidate: RacingLineAsset,
): RacingLineAsset {
  const store = loadStore(storage);
  const previous = store.candidates[candidate.trackId];
  const previousHasDynamics = previous?.points.some(
    (point) => point.headingOffset !== undefined && point.yawRate !== undefined,
  ) ?? false;
  const candidateHasDynamics = candidate.points.some(
    (point) => point.headingOffset !== undefined && point.yawRate !== undefined,
  );
  const previousHasAcceleration = previous?.points.some(
    (point) => point.longitudinalAcceleration !== undefined,
  ) ?? false;
  const candidateHasAcceleration = candidate.points.some(
    (point) => point.longitudinalAcceleration !== undefined,
  );
  const previousHasGripTrace = previous?.points.some(
    (point) => point.tireGrip !== undefined,
  ) ?? false;
  const candidateHasGripTrace = candidate.points.some(
    (point) => point.tireGrip !== undefined,
  );
  const previousHasForwardAcceleration = previous?.points.some(
    (point) => point.forwardAcceleration !== undefined,
  ) ?? false;
  const candidateHasForwardAcceleration = candidate.points.some(
    (point) => point.forwardAcceleration !== undefined,
  );

  // Legacy PLAYER lines only stored position + speed. A single clean modern
  // lap is allowed to replace that legacy candidate even when it is slower,
  // because without demonstrated heading/yaw the CPU cannot reproduce the
  // player's transient rotation reliably. Once upgraded, normal best-lap
  // selection resumes.
  if (
    previous?.lapSeconds !== undefined
    && candidate.lapSeconds !== undefined
    && previous.lapSeconds <= candidate.lapSeconds
    && (previousHasDynamics || !candidateHasDynamics)
    && (previousHasAcceleration || !candidateHasAcceleration)
    && (previousHasGripTrace || !candidateHasGripTrace)
    && (previousHasForwardAcceleration || !candidateHasForwardAcceleration)
  ) {
    return previous;
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
  return {
    progress,
    laneOffset: lerp(a.laneOffset, b.laneOffset, t),
    targetSpeed: lerp(a.speed, b.speed, t),
    headingOffset: interpolateOptionalAngle(a.headingOffset, b.headingOffset, t),
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
