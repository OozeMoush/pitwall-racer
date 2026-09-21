import { describe, expect, it } from 'vitest';
import {
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

  it('persists the explicit player-line choice per circuit', () => {
    const storage = new MemoryStorage();
    saveSelectedRacingLineSource(storage, 'pitwall-gp', 'PLAYER');

    expect(selectedRacingLineSource(storage, 'pitwall-gp')).toBe('PLAYER');
    expect(selectedRacingLineSource(storage, 'velocity-park')).toBe('AUTO');
  });
});
