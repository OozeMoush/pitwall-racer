import {
  calibratedPaceBenchmark,
  type CalibratedPaceBenchmark,
  type EmpiricalLapEvidence,
} from './PaceBenchmarkModel';
import type { TrackId } from './TrackModel';

interface PaceBenchmarkSession {
  trackId: TrackId;
  benchmark: CalibratedPaceBenchmark;
}

let activeSession: PaceBenchmarkSession | undefined;

/**
 * Freeze pace calibration at session start. Evidence recorded during the
 * current qualifying/race cannot change current-session AI difficulty; it only
 * becomes eligible the next time a session is created.
 */
export function installPaceBenchmarkSession(
  trackId: TrackId,
  physicsSeconds: number,
  evidence: readonly EmpiricalLapEvidence[],
): CalibratedPaceBenchmark {
  const benchmark = calibratedPaceBenchmark(trackId, physicsSeconds, evidence);
  activeSession = { trackId, benchmark };
  return benchmark;
}

export function sessionPaceBenchmarkSeconds(trackId: TrackId, fallbackPhysicsSeconds: number): number {
  if (activeSession?.trackId !== trackId) return fallbackPhysicsSeconds;
  return activeSession.benchmark.seconds;
}

/**
 * Convert a faster verified lap into a bounded speed-envelope request. This is
 * not power or grip: the physical car still has to realize the requested speed
 * with the shared chassis, braking and track limits.
 */
export function sessionPaceSpeedScale(trackId: TrackId): number {
  if (activeSession?.trackId !== trackId) return 1;
  const { physicsSeconds, seconds } = activeSession.benchmark;
  if (!(seconds > 0) || !(physicsSeconds > 0)) return 1;
  return clamp(physicsSeconds / seconds, 1, 1.12);
}

export function currentPaceBenchmark(): CalibratedPaceBenchmark | undefined {
  return activeSession?.benchmark;
}

/** Test/session lifecycle helper. */
export function resetPaceBenchmarkSession(): void {
  activeSession = undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
