import type { RacingLineAsset, RacingLineSource } from './RacingLineAsset';
import type { TrackId } from './TrackModel';

const STORAGE_KEY = 'pitwall-racer:racing-line-selection:v1';

export type SelectableRacingLineSource = Extract<
  RacingLineSource,
  'AUTO' | 'PLAYER' | 'EDITOR'
>;

export interface RacingLineSelectionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StoredSelection {
  version: 1;
  selected: Partial<Record<TrackId, SelectableRacingLineSource>>;
  editor: Partial<Record<TrackId, RacingLineAsset>>;
}

export function selectedRacingLineSource(
  storage: RacingLineSelectionStorage,
  trackId: TrackId,
): SelectableRacingLineSource {
  return load(storage).selected[trackId] ?? 'AUTO';
}

export function saveSelectedRacingLineSource(
  storage: RacingLineSelectionStorage,
  trackId: TrackId,
  source: SelectableRacingLineSource,
): void {
  const state = load(storage);
  state.selected[trackId] = source;
  save(storage, state);
}

export function loadEditorRacingLine(
  storage: RacingLineSelectionStorage,
  trackId: TrackId,
): RacingLineAsset | undefined {
  return load(storage).editor[trackId];
}

export function saveEditorRacingLine(
  storage: RacingLineSelectionStorage,
  asset: RacingLineAsset,
): void {
  const state = load(storage);
  state.editor[asset.trackId] = {
    ...asset,
    source: 'EDITOR',
  };
  save(storage, state);
}

function load(storage: RacingLineSelectionStorage): StoredSelection {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<StoredSelection>;
    if (parsed.version !== 1 || !parsed.selected || !parsed.editor) return empty();
    return {
      version: 1,
      selected: parsed.selected,
      editor: parsed.editor,
    };
  } catch {
    return empty();
  }
}

function save(
  storage: RacingLineSelectionStorage,
  state: StoredSelection,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Developer controls must never block the race.
  }
}

function empty(): StoredSelection {
  return { version: 1, selected: {}, editor: {} };
}
