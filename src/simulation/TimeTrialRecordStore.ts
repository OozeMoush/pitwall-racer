import { trackGeometryRevision, type TrackId } from './TrackModel';

export interface TimeTrialLapRecord {
  lapTime: number;
  sectors: [number, number, number];
  recordedAt: number;
}

export interface TimeTrialRecord {
  trackRevision?: string;
  bestLap?: number;
  bestSectors: [number | undefined, number | undefined, number | undefined];
  laps: TimeTrialLapRecord[];
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY_PREFIX = 'pitwall-racer:time-trial:v1:';
const MAX_STORED_LAPS = 20;

export function loadTimeTrialRecord(
  storage: StorageLike,
  trackId: TrackId,
): TimeTrialRecord {
  const empty = emptyRecord();
  try {
    const raw = storage.getItem(KEY_PREFIX + trackId);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<TimeTrialRecord>;
    if (parsed.trackRevision !== trackGeometryRevision(trackId)) return empty;
    const laps = Array.isArray(parsed.laps)
      ? parsed.laps
          .filter(isLapRecord)
          .sort((a, b) => a.lapTime - b.lapTime)
          .slice(0, MAX_STORED_LAPS)
      : [];
    const bestSectors: TimeTrialRecord['bestSectors'] = [0, 1, 2].map((index) => {
      const value = parsed.bestSectors?.[index];
      return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? value
        : undefined;
    }) as TimeTrialRecord['bestSectors'];
    const bestLap = typeof parsed.bestLap === 'number' && Number.isFinite(parsed.bestLap) && parsed.bestLap > 0
      ? parsed.bestLap
      : laps[0]?.lapTime;
    return { trackRevision: parsed.trackRevision, bestLap, bestSectors, laps };
  } catch {
    return empty;
  }
}

export function saveTimeTrialLap(
  storage: StorageLike,
  trackId: TrackId,
  lapTime: number,
  sectors: readonly [number, number, number],
): TimeTrialRecord {
  if (
    !Number.isFinite(lapTime)
    || lapTime <= 0
    || sectors.some((sector) => !Number.isFinite(sector) || sector <= 0)
  ) {
    return loadTimeTrialRecord(storage, trackId);
  }

  const previous = loadTimeTrialRecord(storage, trackId);
  const nextLap: TimeTrialLapRecord = {
    lapTime,
    sectors: [sectors[0], sectors[1], sectors[2]],
    recordedAt: Date.now(),
  };
  const laps = [...previous.laps, nextLap]
    .sort((a, b) => a.lapTime - b.lapTime)
    .slice(0, MAX_STORED_LAPS);
  const bestSectors = previous.bestSectors.map((best, index) =>
    best === undefined ? sectors[index] : Math.min(best, sectors[index]),
  ) as TimeTrialRecord['bestSectors'];
  const record: TimeTrialRecord = {
    trackRevision: trackGeometryRevision(trackId),
    bestLap: previous.bestLap === undefined ? lapTime : Math.min(previous.bestLap, lapTime),
    bestSectors,
    laps,
  };
  storage.setItem(KEY_PREFIX + trackId, JSON.stringify(record));
  return record;
}

function emptyRecord(): TimeTrialRecord {
  return {
    bestSectors: [undefined, undefined, undefined],
    laps: [],
  };
}

function isLapRecord(value: unknown): value is TimeTrialLapRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<TimeTrialLapRecord>;
  return typeof record.lapTime === 'number'
    && Number.isFinite(record.lapTime)
    && record.lapTime > 0
    && Array.isArray(record.sectors)
    && record.sectors.length === 3
    && record.sectors.every((sector) => typeof sector === 'number' && Number.isFinite(sector) && sector > 0);
}
