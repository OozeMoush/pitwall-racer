import type { DriverState } from './RaceModel';
import { referenceExecutionForSkill, referenceLap } from './ReferenceDriverModel';
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
const IDENTITY_SPREAD_SECONDS = 0.10;

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
): number {
  const reference = qualifyingBenchmarkSeconds(trackId, trackLengthMetres);
  const execution = referenceExecutionForSkill(driver.skill);
  const identityOffset = stableOffset(driver.id) * IDENTITY_SPREAD_SECONDS;

  // 100% is the generated reference. F1-level AI sits in the 98.2-99.5%
  // execution band, so a human needs a genuinely near-limit lap to beat the
  // field rather than merely exceeding a manually chosen target.
  return Math.max(10, reference / execution + identityOffset);
}

export function qualifyingClassification(
  playerTime: number,
  ai: readonly Pick<DriverState, 'id' | 'name' | 'skill'>[],
  trackId: TrackId,
  trackLengthMetres: number,
): QualifyingEntry[] {
  const entries = [
    { id: 'player', name: 'YOU', time: playerTime, isPlayer: true },
    ...ai.map((driver) => ({
      id: driver.id,
      name: driver.name,
      time: aiQualifyingTime(driver, trackId, trackLengthMetres),
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
