import { trackGeometryRevision, type TrackId } from './TrackModel';
import type { Compound } from './TireModel';

export const DRIVER_HISTORY_KEY = 'pitwall-racer:driver-history:v1';
export const DRIVER_HISTORY_LIMITS = { laps: 500, bests: 64, updates: 200 };
export const TT_HISTORY_RULES = 'tt-soft-push-physics-v1';
export const HISTORY_REASONS = ['TRACK_LIMITS', 'WALL_CONTACT', 'CAR_CONTACT', 'RECOVERY', 'TIMING_INCOMPLETE'] as const;
export type HistoryReason = typeof HISTORY_REASONS[number];
export interface HistoryStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface DriverLap {
  id: string;
  sessionId: string;
  lapNumber: number;
  recordedAt: number;
  trackId: string;
  trackRevision: string;
  mode: 'TIME_TRIAL';
  rulesVersion: string;
  compound: Compound;
  startWear: number;
  endWear: number;
  startTemperature: number;
  endTemperature: number;
  seconds: number;
  sectors?: [number, number, number];
  valid: boolean;
  reasons: HistoryReason[];
}
export interface BestUpdate { lap: DriverLap; previousSeconds: number | null }
export interface DriverHistory {
  version: 1;
  laps: DriverLap[];
  bests: DriverLap[];
  updates: BestUpdate[];
  omittedLaps: number;
  omittedBests: number;
  omittedUpdates: number;
}
export type HistoryStatus = 'OK' | 'CORRUPT' | 'UNSUPPORTED' | 'STORAGE_FAILED';
export function emptyDriverHistory(): DriverHistory {
  return { version: 1, laps: [], bests: [], updates: [], omittedLaps: 0, omittedBests: 0, omittedUpdates: 0 };
}
export function cleanHistoryLap(lap: DriverLap): boolean { return lap.valid && lap.reasons.length === 0 && !!lap.sectors; }
/** Bands are approximate matching conditions, not proof of identical grip. */
export function historyConditionKey(lap: DriverLap): string {
  return JSON.stringify([lap.trackId, lap.trackRevision, lap.mode, lap.rulesVersion, lap.compound,
    Math.min(9, Math.floor(lap.startWear * 10)), Math.floor(lap.startTemperature / 5)]);
}
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const bounded = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const text = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 160;
function validLap(value: unknown): value is DriverLap {
  if (!value || typeof value !== 'object') return false;
  const lap = value as DriverLap;
  return [lap.id, lap.sessionId, lap.trackId, lap.trackRevision, lap.rulesVersion].every(text)
    && Number.isInteger(lap.lapNumber) && lap.lapNumber > 0
    && bounded(lap.recordedAt, 1, 8.64e15) && lap.mode === 'TIME_TRIAL'
    && ['SOFT', 'MEDIUM', 'HARD'].includes(lap.compound)
    && [lap.startWear, lap.endWear].every(n => bounded(n, 0, 1))
    && [lap.startTemperature, lap.endTemperature].every(n => bounded(n, 0, 200))
    && positive(lap.seconds) && lap.seconds <= Number.MAX_SAFE_INTEGER && typeof lap.valid === 'boolean'
    && Array.isArray(lap.reasons) && lap.reasons.length <= HISTORY_REASONS.length
    && lap.reasons.every(r => HISTORY_REASONS.includes(r))
    && (lap.sectors === undefined || (Array.isArray(lap.sectors) && lap.sectors.length === 3
      && lap.sectors.every(positive) && Math.abs(lap.sectors.reduce((a,b) => a+b, 0) - lap.seconds) < 0.05));
}
export function loadDriverHistory(storage: HistoryStorage): { history: DriverHistory; status: HistoryStatus } {
  const empty = emptyDriverHistory();
  let raw: string | null;
  try { raw = storage.getItem(DRIVER_HISTORY_KEY); } catch { return { history: empty, status: 'STORAGE_FAILED' }; }
  if (!raw) return { history: empty, status: 'OK' };
  try {
    const h = JSON.parse(raw) as DriverHistory;
    if (!h || typeof h !== 'object') throw new Error('shape');
    if (typeof h.version === 'number' && h.version > 1) return { history: empty, status: 'UNSUPPORTED' };
    if (h.version !== 1) throw new Error('version');
    if (!Array.isArray(h.laps) || h.laps.length > DRIVER_HISTORY_LIMITS.laps || !h.laps.every(validLap)
      || !Array.isArray(h.bests) || h.bests.length > DRIVER_HISTORY_LIMITS.bests || !h.bests.every(l => validLap(l) && cleanHistoryLap(l))
      || new Set(h.bests.map(historyConditionKey)).size !== h.bests.length
      || !Array.isArray(h.updates) || h.updates.length > DRIVER_HISTORY_LIMITS.updates
      || !h.updates.every(u => u && validLap(u.lap) && cleanHistoryLap(u.lap)
        && (u.previousSeconds === null || (positive(u.previousSeconds) && u.previousSeconds > u.lap.seconds)))
      || ![h.omittedLaps, h.omittedBests, h.omittedUpdates].every(n => Number.isInteger(n) && n >= 0)
      || new Set(h.laps.map(l => l.id)).size !== h.laps.length) throw new Error('shape');
    return { history: h, status: 'OK' };
  } catch { return { history: empty, status: 'CORRUPT' }; }
}
export function saveDriverHistoryLap(storage: HistoryStorage, lap: DriverLap) {
  const loaded = loadDriverHistory(storage);
  if (loaded.status !== 'OK') return loaded;
  const h: DriverHistory = { ...loaded.history, laps: [...loaded.history.laps], bests: [...loaded.history.bests], updates: [...loaded.history.updates] };
  if (!validLap(lap)) return { history: h, status: 'INVALID' as const };
  if (h.laps.some(l => l.id === lap.id) || h.bests.some(l => l.id === lap.id) || h.updates.some(u => u.lap.id === lap.id)) {
    return { history: h, status: 'DUPLICATE' as const };
  }
  h.laps.push(lap);
  if (h.laps.length > DRIVER_HISTORY_LIMITS.laps) { h.laps.shift(); h.omittedLaps++; }
  const key = historyConditionKey(lap);
  const previous = h.bests.find(l => historyConditionKey(l) === key)
    ?? [...h.laps, ...h.updates.map(u => u.lap)].filter(l => l.id !== lap.id && cleanHistoryLap(l) && historyConditionKey(l) === key)
      .sort((a,b) => a.seconds-b.seconds)[0];
  if (cleanHistoryLap(lap) && (!previous || lap.seconds < previous.seconds)) {
    h.bests = h.bests.filter(l => historyConditionKey(l) !== key);
    h.bests.push(lap);
    h.updates.push({ lap, previousSeconds: previous?.seconds ?? null });
    if (h.updates.length > DRIVER_HISTORY_LIMITS.updates) { h.updates.shift(); h.omittedUpdates++; }
  } else if (previous) {
    // Keep actively used anchors even if the latest attempt is slower/invalid.
    h.bests = h.bests.filter(l => historyConditionKey(l) !== key);
    h.bests.push(previous);
  }
  if (h.bests.length > DRIVER_HISTORY_LIMITS.bests) { h.bests.shift(); h.omittedBests++; }
  try { storage.setItem(DRIVER_HISTORY_KEY, JSON.stringify(h)); }
  catch { return { history: loaded.history, status: 'STORAGE_FAILED' as const }; }
  return { history: h, status: 'SAVED' as const };
}

/** Per-lap events are only tiny set insertions; storage runs once at completion.
 * A completed attempt can be consumed only once. An unfinished lap is not invented. */
export class TimeTrialHistoryRecorder {
  private sequence = 0;
  private current?: Omit<DriverLap, 'seconds' | 'sectors' | 'valid' | 'endWear' | 'endTemperature' | 'recordedAt' | 'reasons'>;
  private reasons = new Set<HistoryReason>();
  constructor(readonly sessionId: string = globalThis.crypto?.randomUUID?.() ?? `tt-${Date.now()}-${Math.random().toString(36).slice(2)}`) {}
  begin(trackId: TrackId, compound: Compound, wear: number, temperature: number): void {
    this.sequence++;
    this.reasons.clear();
    this.current = { id: `${this.sessionId}:${this.sequence}`, sessionId: this.sessionId,
      lapNumber: this.sequence, trackId, trackRevision: trackGeometryRevision(trackId), mode: 'TIME_TRIAL',
      rulesVersion: TT_HISTORY_RULES, compound, startWear: wear, startTemperature: temperature };
  }
  flag(reason: HistoryReason): void { if (this.current) this.reasons.add(reason); }
  finish(seconds: number, sectors: [number, number, number] | undefined, valid: boolean,
    endWear: number, endTemperature: number, recordedAt = Date.now()): DriverLap | undefined {
    const current = this.current;
    if (!current || !positive(seconds)) return undefined;
    this.current = undefined;
    if (!sectors) this.reasons.add('TIMING_INCOMPLETE');
    return { ...current, seconds, sectors, valid, endWear, endTemperature, recordedAt, reasons: [...this.reasons] };
  }
}
