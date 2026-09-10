import { raceDistance } from './RaceModel';

export interface RaceGapSource {
  lap: number;
  progress: number;
}

/**
 * Convert the live distance along the race into a time-like interval using a
 * representative lap. This is deliberately stable instead of dividing by an
 * instantaneous corner speed, which would make the HUD gap jump every braking
 * zone.
 */
export function raceGapSeconds(a: RaceGapSource, b: RaceGapSource, referenceLapSeconds: number): number {
  const lapDelta = Math.abs(raceDistance(a.lap, a.progress) - raceDistance(b.lap, b.progress));
  return lapDelta * Math.max(1, referenceLapSeconds);
}

export function formatRaceGap(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds >= 99.5) return '99.9+s';
  return `${Math.max(0, seconds).toFixed(1)}s`;
}
