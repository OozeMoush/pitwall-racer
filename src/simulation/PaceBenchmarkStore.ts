import { trackGeometryRevision } from './TrackModel';
import type { EmpiricalLapEvidence } from './PaceBenchmarkModel';

const STORAGE_KEY = 'pitwall-racer:pace-evidence:v1';
const MAX_STORED_LAPS = 40;

export interface PaceEvidenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type StoredLapEvidence = EmpiricalLapEvidence & { trackRevision?: string };

interface StoredEvidence {
  version: 1;
  laps: StoredLapEvidence[];
}

export function loadPaceEvidence(storage: PaceEvidenceStorage): EmpiricalLapEvidence[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<StoredEvidence>;
    if (parsed.version !== 1 || !Array.isArray(parsed.laps)) return [];
    return parsed.laps
      .filter(isLapEvidence)
      .filter((lap) => lap.trackRevision === trackGeometryRevision(lap.trackId))
      .slice(0, MAX_STORED_LAPS);
  } catch {
    return [];
  }
}

export function savePaceEvidence(
  storage: PaceEvidenceStorage,
  evidence: EmpiricalLapEvidence,
): EmpiricalLapEvidence[] {
  const existing = loadPaceEvidence(storage);
  const revisionedEvidence: StoredLapEvidence = {
    ...evidence,
    trackRevision: trackGeometryRevision(evidence.trackId),
  };
  const laps = [revisionedEvidence, ...existing]
    .sort((a, b) => a.seconds - b.seconds)
    .slice(0, MAX_STORED_LAPS);
  const payload: StoredEvidence = { version: 1, laps };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Persistence is a calibration aid, never a reason to break the race loop.
  }
  return laps;
}

function isLapEvidence(value: unknown): value is StoredLapEvidence {
  if (!value || typeof value !== 'object') return false;
  const lap = value as Record<string, unknown>;
  return typeof lap.trackId === 'string'
    && typeof lap.seconds === 'number'
    && typeof lap.compound === 'string'
    && typeof lap.startWear === 'number'
    && typeof lap.endWear === 'number'
    && typeof lap.deepCutRatio === 'number'
    && typeof lap.grassRatio === 'number'
    && typeof lap.maxTow === 'number'
    && typeof lap.launchAffected === 'boolean'
    && typeof lap.recovered === 'boolean'
    && typeof lap.pitted === 'boolean';
}
