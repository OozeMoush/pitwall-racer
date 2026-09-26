import type { DriverState } from './RaceModel';
import { referenceLap } from './ReferenceDriverModel';
import { compoundPeakGrip } from './TireModel';
import type { TrackId } from './TrackModel';

export interface QualifyingEntry {
  id: string;
  name: string;
  time: number;
  position: number;
  isPlayer: boolean;
}

const QUALIFYING_REFERENCE_GRIP = compoundPeakGrip('SOFT', 'PUSH');
const IDENTITY_SPREAD_SECONDS = 0.07;
const AI_QUALIFYING_PACE_MIN = 0.996;
const AI_QUALIFYING_PACE_MAX = 1.012;

/**
 * The benchmark is no longer a hand-authored km/h target or a player-derived
 * lap. It is the machine-limit reference lap generated from circuit geometry
 * and the same acceleration/braking/steering equations used by the car.
 */
export function qualifyingBenchmarkSeconds(trackId: TrackId, _trackLengthMetres: number): number {
  return referenceLap(trackId, QUALIFYING_REFERENCE_GRIP).lapSeconds;
}

export function aiQualifyingTime(
  driver: Pick<DriverState, 'id' | 'skill'>,
  trackId: TrackId,
  trackLengthMetres: number,
  benchmarkSeconds?: number,
): number {
  const reference = benchmarkSeconds
    ?? qualifyingBenchmarkSeconds(trackId, trackLengthMetres);
  const t = clamp((driver.skill - 1.118) / (1.136 - 1.118), 0, 1);
  const pace = AI_QUALIFYING_PACE_MIN
    + (AI_QUALIFYING_PACE_MAX - AI_QUALIFYING_PACE_MIN) * t;
  const identityOffset = stableOffset(driver.id) * IDENTITY_SPREAD_SECONDS;

  // Qualifying reflects the stronger race field: the weakest car can sit just
  // below the demonstrated benchmark while the strongest gets about a
  // one-percent-plus one-lap advantage.
  return Math.max(10, reference / pace + identityOffset);
}

export function qualifyingClassification(
  playerTime: number,
  ai: readonly Pick<DriverState, 'id' | 'name' | 'skill'>[],
  trackId: TrackId,
  trackLengthMetres: number,
  benchmarkSeconds?: number,
): QualifyingEntry[] {
  const entries = [
    { id: 'player', name: 'YOU', time: playerTime, isPlayer: true },
    ...ai.map((driver) => ({
      id: driver.id,
      name: driver.name,
      time: aiQualifyingTime(
        driver,
        trackId,
        trackLengthMetres,
        benchmarkSeconds,
      ),
      isPlayer: false,
    })),
  ]
    .sort((a, b) => a.time - b.time)
    .map((entry, index) => ({ ...entry, position: index + 1 }));

  return entries;
}

export function qualifyingGridOrder(entries: readonly QualifyingEntry[]): string[] {
  return [...entries]
    .sort((a, b) => a.position - b.position)
    .map((entry) => entry.id);
}

function stableOffset(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unit = ((hash >>> 0) % 1000) / 999;
  return unit - 0.5;
}


function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
