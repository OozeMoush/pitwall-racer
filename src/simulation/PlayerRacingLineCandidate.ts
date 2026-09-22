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

    this.samples.push({
      progress: p,
      laneOffset,
      speed: Math.max(0, speed),
      headingOffset: Number.isFinite(headingOffset) ? headingOffset : undefined,
      yawRate: Number.isFinite(yawRate) ? yawRate : undefined,
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

  if (high <= 0) {
    const first = samples[0];
    return {
      progress,
      laneOffset: first.laneOffset,
      targetSpeed: first.speed,
      headingOffset: first.headingOffset,
      yawRate: first.yawRate,
    };
  }
  if (high >= samples.length) {
    const last = samples[samples.length - 1];
    return {
      progress,
      laneOffset: last.laneOffset,
      targetSpeed: last.speed,
      headingOffset: last.headingOffset,
      yawRate: last.yawRate,
    };
  }

  const a = samples[high - 1];
  const b = samples[high];
  const span = Math.max(0.000001, b.progress - a.progress);
  const t = (progress - a.progress) / span;
  return {
    progress,
    laneOffset: lerp(a.laneOffset, b.laneOffset, t),
    targetSpeed: lerp(a.speed, b.speed, t),
    headingOffset: interpolateOptionalAngle(a.headingOffset, b.headingOffset, t),
    yawRate: interpolateOptional(a.yawRate, b.yawRate, t),
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
