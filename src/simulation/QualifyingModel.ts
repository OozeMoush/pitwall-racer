import type { DriverState } from './RaceModel';
import type { TrackId } from './TrackModel';

export interface QualifyingEntry {
  id: string;
  name: string;
  time: number;
  position: number;
  isPlayer: boolean;
}

interface QualifyingTrackProfile {
  averageKmh: number;
  spreadSeconds: number;
}

const TRACK_PROFILE: Record<TrackId, QualifyingTrackProfile> = {
  'pitwall-gp': { averageKmh: 278, spreadSeconds: 0.86 },
  'velocity-park': { averageKmh: 292, spreadSeconds: 0.78 },
  'switchback-ring': { averageKmh: 260, spreadSeconds: 0.94 },
};

/**
 * A qualifying benchmark is intentionally tougher than an average race lap.
 * It is a flying-lap target, not a hidden rubber-band: the same target is used
 * whether the player is fast or slow.
 */
export function qualifyingBenchmarkSeconds(trackId: TrackId, trackLengthMetres: number): number {
  const profile = TRACK_PROFILE[trackId];
  return trackLengthMetres / (profile.averageKmh / 3.6);
}

export function aiQualifyingTime(
  driver: Pick<DriverState, 'id' | 'skill'>,
  trackId: TrackId,
  trackLengthMetres: number,
): number {
  const profile = TRACK_PROFILE[trackId];
  const benchmark = qualifyingBenchmarkSeconds(trackId, trackLengthMetres);
  const skillReference = 1.127;
  const skillGain = (driver.skill - skillReference) * 18;
  const identityOffset = stableOffset(driver.id) * profile.spreadSeconds;
  return Math.max(30, benchmark - skillGain + identityOffset);
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
