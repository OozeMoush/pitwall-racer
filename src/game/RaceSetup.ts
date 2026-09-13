import type { Compound } from '../simulation/TireModel';
import type { TrackId } from '../simulation/TrackModel';

export interface RaceSetup {
  trackId: TrackId;
  startCompound: Compound;
  totalLaps: number;
  /** P1..P8 driver ids produced by the one-shot qualifying session. */
  gridOrder?: readonly string[];
  qualifyingTime?: number;
}

export const DEFAULT_RACE_SETUP: RaceSetup = {
  trackId: 'pitwall-gp',
  startCompound: 'MEDIUM',
  totalLaps: 50,
};

export const LAP_OPTIONS = [40, 50, 60] as const;
