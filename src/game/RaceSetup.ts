import type { Compound } from '../simulation/TireModel';
import type { TrackId } from '../simulation/TrackModel';

export interface RaceSetup {
  trackId: TrackId;
  startCompound: Compound;
  totalLaps: number;
}

export const DEFAULT_RACE_SETUP: RaceSetup = {
  trackId: 'pitwall-gp',
  startCompound: 'MEDIUM',
  totalLaps: 12,
};

export const LAP_OPTIONS = [10, 12, 16] as const;
