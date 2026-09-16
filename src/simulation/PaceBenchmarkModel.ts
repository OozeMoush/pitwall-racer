import type { Compound } from './TireModel';
import type { TrackId } from './TrackModel';

/**
 * Runtime evidence used to challenge a solver-derived machine limit.
 *
 * This is deliberately stricter than ordinary lap timing. A lap can count in
 * the race results while still being unsuitable as proof of the car's clean
 * machine capability (for example after a deep cut, tow, recovery, pit stop,
 * or with a heavily worn tyre). Keeping those concepts separate prevents a
 * personal best from silently turning into rubber-band difficulty.
 */
export interface EmpiricalLapEvidence {
  trackId: TrackId;
  seconds: number;
  compound: Compound;
  startWear: number;
  endWear: number;
  deepCutRatio: number;
  grassRatio: number;
  maxTow: number;
  launchAffected: boolean;
  recovered: boolean;
  pitted: boolean;
}

export type EmpiricalLapRejectionReason =
  | 'INVALID_TIME'
  | 'NOT_SOFT'
  | 'TYRE_NOT_FRESH'
  | 'DEEP_CUT'
  | 'GRASS'
  | 'TOW'
  | 'LAUNCH_EFFECT'
  | 'RECOVERY'
  | 'PIT_LAP';

export interface EmpiricalLapAssessment {
  eligibleForMachineLimit: boolean;
  reasons: readonly EmpiricalLapRejectionReason[];
}

export interface CalibratedPaceBenchmark {
  seconds: number;
  source: 'PHYSICS' | 'EMPIRICAL';
  physicsSeconds: number;
  empiricalSeconds?: number;
  solverGapSeconds: number;
}

const MAX_FRESH_START_WEAR = 0.10;
const MAX_FRESH_END_WEAR = 0.25;
const MAX_DEEP_CUT_RATIO = 0.001;
const MAX_GRASS_RATIO = 0;
const MAX_TOW = 0.02;

/**
 * Decide whether a runtime lap is comparable to the fresh-Soft, clean-air
 * machine-limit reference used by qualifying.
 */
export function assessEmpiricalLap(evidence: EmpiricalLapEvidence): EmpiricalLapAssessment {
  const reasons: EmpiricalLapRejectionReason[] = [];

  if (!Number.isFinite(evidence.seconds) || evidence.seconds < 10 || evidence.seconds > 300) {
    reasons.push('INVALID_TIME');
  }
  if (evidence.compound !== 'SOFT') reasons.push('NOT_SOFT');
  if (evidence.startWear > MAX_FRESH_START_WEAR || evidence.endWear > MAX_FRESH_END_WEAR) {
    reasons.push('TYRE_NOT_FRESH');
  }
  if (evidence.deepCutRatio > MAX_DEEP_CUT_RATIO) reasons.push('DEEP_CUT');
  if (evidence.grassRatio > MAX_GRASS_RATIO) reasons.push('GRASS');
  if (evidence.maxTow > MAX_TOW) reasons.push('TOW');
  if (evidence.launchAffected) reasons.push('LAUNCH_EFFECT');
  if (evidence.recovered) reasons.push('RECOVERY');
  if (evidence.pitted) reasons.push('PIT_LAP');

  return {
    eligibleForMachineLimit: reasons.length === 0,
    reasons,
  };
}

/**
 * A solver is allowed to predict a faster lap than anybody has demonstrated.
 * It is not allowed to call a slower lap the "machine limit" once the same
 * runtime physics has produced a verified, comparable faster lap.
 *
 * This function is intentionally only a benchmark/calibration primitive. It
 * does not grant AI cars power or grip and it does not make the current player
 * lap an adaptive difficulty target.
 */
export function calibratedPaceBenchmark(
  trackId: TrackId,
  physicsSeconds: number,
  evidence: readonly EmpiricalLapEvidence[],
): CalibratedPaceBenchmark {
  const comparable = evidence
    .filter((lap) => lap.trackId === trackId && assessEmpiricalLap(lap).eligibleForMachineLimit)
    .map((lap) => lap.seconds)
    .filter(Number.isFinite);
  const empiricalSeconds = comparable.length > 0 ? Math.min(...comparable) : undefined;
  const seconds = empiricalSeconds === undefined
    ? physicsSeconds
    : Math.min(physicsSeconds, empiricalSeconds);
  const source: CalibratedPaceBenchmark['source'] = empiricalSeconds !== undefined
      && empiricalSeconds < physicsSeconds
    ? 'EMPIRICAL'
    : 'PHYSICS';

  return {
    seconds,
    source,
    physicsSeconds,
    empiricalSeconds,
    solverGapSeconds: empiricalSeconds === undefined
      ? 0
      : Math.max(0, physicsSeconds - empiricalSeconds),
  };
}
