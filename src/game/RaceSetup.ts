import type { Compound } from '../simulation/TireModel';
import { getTrackDefinition, type TrackId } from '../simulation/TrackModel';

export type RaceLengthPreset = 'QUICK' | 'SHORT' | 'STANDARD' | 'LONG';

export interface RaceSetup {
  /** Trial GP passing; only Pitwall GP AUTO currently enables it. */
  experimentalPassing?: boolean;
  trackId: TrackId;
  startCompound: Compound;
  totalLaps: number;
  /** Duration preset used to derive totalLaps for the selected circuit. */
  raceLength?: RaceLengthPreset;
  /** P1..P8 driver ids produced by the one-shot qualifying session. */
  gridOrder?: readonly string[];
  qualifyingTime?: number;
  /** Skip the one-shot qualifying session and start the race from P8. */
  skipQualifying?: boolean;
  /** Run an empty-track continuous hotlap session before starting from P8. */
  timeTrial?: boolean;
}

export interface RaceLengthOption {
  id: RaceLengthPreset;
  label: string;
  targetMinutes: number;
}

export const RACE_LENGTH_OPTIONS: readonly RaceLengthOption[] = [
  { id: 'QUICK', label: 'QUICK', targetMinutes: 8 },
  { id: 'SHORT', label: 'SHORT', targetMinutes: 18 },
  { id: 'STANDARD', label: 'STANDARD', targetMinutes: 27 },
  { id: 'LONG', label: 'LONG', targetMinutes: 36 },
];

export const DEFAULT_RACE_LENGTH: RaceLengthPreset = 'STANDARD';

export function raceLapsForPreset(
  trackId: TrackId,
  preset: RaceLengthPreset,
): number {
  const option = RACE_LENGTH_OPTIONS.find((entry) => entry.id === preset)
    ?? RACE_LENGTH_OPTIONS.find((entry) => entry.id === DEFAULT_RACE_LENGTH)!;
  const lapSeconds = Math.max(
    15,
    getTrackDefinition(trackId).referenceLapSeconds ?? 90,
  );
  return Math.max(6, Math.round(option.targetMinutes * 60 / lapSeconds));
}

export const DEFAULT_RACE_SETUP: RaceSetup = {
  trackId: 'pitwall-gp',
  startCompound: 'MEDIUM',
  raceLength: DEFAULT_RACE_LENGTH,
  totalLaps: raceLapsForPreset('pitwall-gp', DEFAULT_RACE_LENGTH),
};
