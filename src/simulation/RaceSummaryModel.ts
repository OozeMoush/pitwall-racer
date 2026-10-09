import { raceDistance } from './RaceModel';
import type { Compound } from './TireModel';

export type SummaryPitPhase = 'NONE' | 'TRANSIT_IN' | 'SERVICE' | 'TRANSIT_OUT';
export interface SummaryContext {
  experimentalPassing?: boolean;
  trackId: string;
  trackRevision: string;
  totalLaps: number;
  startCompound: Compound;
  gridOrder: string[];
  raceLength?: string;
  qualifyingTime?: number;
  line: { source: string; fingerprint: string };
  /** Version of physical/balance semantics; schema version alone is insufficient. */
  rulesVersion: string;
}
export interface SummaryCar {
  id: string;
  name: string;
  lap: number;
  progress: number;
  compound: Compound;
  wear: number;
  pitPhase: SummaryPitPhase;
  finished: boolean;
  retired?: boolean;
  disqualified?: boolean;
  pendingPenaltySeconds?: number;
}
export interface SummaryLap {
  driverId: string;
  lap: number;
  seconds: number;
  time: number;
  startCompound: Compound;
  endCompound: Compound;
  pitted: boolean;
  /** Grand Prix counted validity is independent of driving-clean evidence. */
  counted: boolean;
  clean?: boolean;
}
export interface SummarySample {
  time: number;
  cars: Array<SummaryCar & { position: number; gapToPlayerSeconds: number | null; lapDifference: number }>;
}
export interface SummaryEvent {
  time: number;
  driverId: string;
  lap: number;
  kind: 'PIT_IN' | 'SERVICE' | 'PIT_OUT' | 'REJOIN' | 'LINE_CHANGE';
  compound?: Compound;
  line?: SummaryContext['line'];
}
export interface RaceSummary {
  version: 1;
  sessionMode: 'RACE';
  sessionId: string;
  startedAt: string;
  status: 'IN_PROGRESS' | 'PLAYER_FINISHED' | 'ABORTED';
  context: SummaryContext;
  elapsedSeconds: number;
  samples: SummarySample[];
  events: SummaryEvent[];
  laps: SummaryLap[];
  sampleIntervalSeconds: number;
  omittedEvents: number;
  omittedLaps: number;
  /** Observation at session cutoff, not a predicted final classification. */
  cutoff: SummarySample | null;
}
const MAX_SAMPLES = 2048;
const MAX_EVENTS = 512;
const MAX_LAPS = 4096;

/** Bounded observation recorder. No physics/projection or strategy prediction.
 * Capture positions/gaps at 1 Hz; phase transitions are detected each tick.
 * Long sessions thin only position samples; exact retained event times survive. */
export class RaceSummaryRecorder {
  private readonly data: RaceSummary;
  private readonly phases = new Map<string, SummaryPitPhase>();
  private nextSample = 0;
  private lastTime = -1;
  private lastLine: string;
  constructor(context: SummaryContext, sessionId: string = newSessionId(), startedAt = new Date().toISOString()) {
    this.lastLine = context.line.fingerprint;
    this.data = {
      version: 1, sessionMode: 'RACE', sessionId, startedAt, status: 'IN_PROGRESS',
      context: structuredClone(context), elapsedSeconds: 0, samples: [], events: [], laps: [],
      sampleIntervalSeconds: 1, omittedEvents: 0, omittedLaps: 0, cutoff: null,
    };
  }
  observe(time: number, cars: readonly SummaryCar[], gap: (id: string) => number | undefined): void {
    if (this.data.status !== 'IN_PROGRESS' || !Number.isFinite(time) || time < this.lastTime) return;
    this.lastTime = time;
    this.data.elapsedSeconds = time;
    for (const car of cars) {
      const old = this.phases.get(car.id) ?? 'NONE';
      this.phases.set(car.id, car.pitPhase);
      if (old === car.pitPhase) continue;
      const kind = car.pitPhase === 'TRANSIT_IN' ? 'PIT_IN'
        : car.pitPhase === 'SERVICE' ? 'SERVICE'
        : car.pitPhase === 'TRANSIT_OUT' ? 'PIT_OUT'
        : old === 'TRANSIT_OUT' ? 'REJOIN' : undefined;
      if (kind) this.event({ time, driverId: car.id, lap: car.lap, kind, compound: car.compound });
    }
    if (time + 1e-7 < this.nextSample) return;
    this.appendSample(this.sample(time, cars, gap));
    this.nextSample = time + this.data.sampleIntervalSeconds;
  }
  recordLap(lap: SummaryLap): void {
    if (this.data.status !== 'IN_PROGRESS' || !Number.isFinite(lap.seconds) || lap.seconds <= 0
      || !Number.isFinite(lap.time) || lap.lap < 1) return;
    // One lap per driver. Repeated callbacks never create duplicate records.
    if (this.data.laps.some(row => row.driverId === lap.driverId && row.lap === lap.lap)) return;
    if (this.data.laps.length === MAX_LAPS) { this.data.laps.shift(); this.data.omittedLaps++; }
    this.data.laps.push({ ...lap });
  }
  lineChanged(time: number, line: SummaryContext['line']): void {
    if (this.data.status !== 'IN_PROGRESS' || this.lastLine === line.fingerprint) return;
    this.lastLine = line.fingerprint;
    this.event({ time, driverId: 'field', lap: 0, kind: 'LINE_CHANGE', line: { ...line } });
  }
  finish(status: 'PLAYER_FINISHED' | 'ABORTED', time: number, cars: readonly SummaryCar[], gap: (id: string) => number | undefined): void {
    if (this.data.status !== 'IN_PROGRESS' || !Number.isFinite(time) || time < this.lastTime) return;
    this.observe(time, cars, gap);
    this.data.cutoff = this.sample(time, cars, gap);
    if (this.data.samples.at(-1)?.time !== time) this.appendSample(this.data.cutoff);
    this.data.status = status;
  }
  snapshot(): RaceSummary { return structuredClone(this.data); }
  private event(event: SummaryEvent): void {
    if (this.data.events.length === MAX_EVENTS) { this.data.events.shift(); this.data.omittedEvents++; }
    this.data.events.push(event);
  }
  private appendSample(sample: SummarySample): void {
    if (this.data.samples.length === MAX_SAMPLES) {
      this.data.samples = this.data.samples.filter((_, index) => index % 2 === 0);
      this.data.sampleIntervalSeconds *= 2;
    }
    this.data.samples.push(sample);
  }
  private sample(time: number, cars: readonly SummaryCar[], gap: (id: string) => number | undefined): SummarySample {
    const player = cars.find(car => car.id === 'player');
    return { time, cars: [...cars].sort((a, b) => raceDistance(b.lap, b.progress) - raceDistance(a.lap, a.progress)).map((car, index) => {
      const seconds = car.id === 'player' ? 0 : gap(car.id);
      const distance = player ? raceDistance(car.lap, car.progress) - raceDistance(player.lap, player.progress) : 0;
      return { ...car, position: index + 1,
        gapToPlayerSeconds: seconds !== undefined && Number.isFinite(seconds) ? seconds : null,
        lapDifference: Math.trunc(distance) };
    }) };
  }
}

/** Stable value identity for reference-line comparison; compute only when the
 * immutable asset changes, never within steering or projection loops. */
export function summaryFingerprint(value: unknown): string {
  const text = JSON.stringify(value) ?? 'undefined';
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

let sessionSequence = 0;
function newSessionId(): string {
  // HTTP LAN/Tailscale origins may not expose crypto.randomUUID. This identity
  // is bookkeeping, not an authentication secret.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `race-${Date.now().toString(36)}-${++sessionSequence}-${Math.random().toString(36).slice(2)}`;
}
