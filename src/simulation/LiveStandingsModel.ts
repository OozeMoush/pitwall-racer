import { classify } from './RaceModel';
import { projectTrack } from './TrackModel';
import type { VehicleState } from './VehicleModel';

export interface LiveStandingSource {
  id: string;
  name: string;
  lap: number;
  vehicle: Pick<VehicleState, 'x' | 'y'>;
}

export interface LiveStandingEntry {
  id: string;
  name: string;
  lap: number;
  progress: number;
}

/**
 * Build classification from the actual Rapier body positions seen this frame.
 * This avoids a stale HUD when a dynamic car has passed but its older strategic
 * progress value has not yet caught up.
 */
export function classifyLivePositions(sources: readonly LiveStandingSource[]): LiveStandingEntry[] {
  return classify(sources.map((source) => ({
    id: source.id,
    name: source.name,
    lap: source.lap,
    progress: projectTrack(source.vehicle.x, source.vehicle.y).progress,
  })));
}
