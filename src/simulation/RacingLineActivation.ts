import { loadPlayerRacingLineCandidate } from './PlayerRacingLineCandidate';
import { setRuntimeRacingLine } from './RacingLineRuntime';
import {
  loadEditorRacingLine,
  selectedRacingLineSource,
  type RacingLineSelectionStorage,
} from './RacingLineSelectionStore';
import type { RacingLineAsset } from './RacingLineAsset';
import type { TrackId } from './TrackModel';

export interface RacingLineActivation {
  source: 'AUTO' | 'PLAYER' | 'EDITOR';
  asset?: RacingLineAsset;
}

export function activateStoredRacingLine(
  storage: RacingLineSelectionStorage,
  trackId: TrackId,
): RacingLineActivation {
  const source = selectedRacingLineSource(storage, trackId);

  if (source === 'PLAYER') {
    const asset = loadPlayerRacingLineCandidate(storage, trackId);
    setRuntimeRacingLine(trackId, asset);
    return asset ? { source, asset } : { source: 'AUTO' };
  }

  if (source === 'EDITOR') {
    const asset = loadEditorRacingLine(storage, trackId);
    setRuntimeRacingLine(trackId, asset);
    return asset ? { source, asset } : { source: 'AUTO' };
  }

  setRuntimeRacingLine(trackId, undefined);
  return { source: 'AUTO' };
}
