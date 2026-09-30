import { describe, expect, it } from 'vitest';
import {
  loadEditorRacingLine,
  saveEditorRacingLine,
  saveSelectedRacingLineSource,
  selectedRacingLineSource,
  type RacingLineSelectionStorage,
} from './RacingLineSelectionStore';

class MemoryStorage implements RacingLineSelectionStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('RacingLineSelectionStore', () => {
  it('defaults each circuit to the machine-generated line', () => {
    expect(selectedRacingLineSource(new MemoryStorage(), 'pitwall-gp')).toBe('AUTO');
  });

  it('stamps editor lines with the current geometry and rejects stale ones', () => {
    const storage = new MemoryStorage();
    saveEditorRacingLine(storage, {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'EDITOR',
      points: [{ progress: 0, laneOffset: 0, targetSpeed: 50 }],
    });

    expect(loadEditorRacingLine(storage, 'pitwall-gp')).toBeDefined();

    const raw = storage.getItem('pitwall-racer:racing-line-selection:v1');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    parsed.editor['pitwall-gp'].trackRevision = 'g1-stale';
    storage.setItem('pitwall-racer:racing-line-selection:v1', JSON.stringify(parsed));

    expect(loadEditorRacingLine(storage, 'pitwall-gp')).toBeUndefined();
  });

  it('persists the explicit player-line choice per circuit', () => {
    const storage = new MemoryStorage();
    saveSelectedRacingLineSource(storage, 'pitwall-gp', 'PLAYER');

    expect(selectedRacingLineSource(storage, 'pitwall-gp')).toBe('PLAYER');
    expect(selectedRacingLineSource(storage, 'velocity-park')).toBe('AUTO');
  });
});
