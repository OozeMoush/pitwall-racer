import { describe, expect, it } from 'vitest';
import { loadTimeTrialRecord, saveTimeTrialLap } from './TimeTrialRecordStore';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('TimeTrialRecordStore', () => {
  it('persists all-time lap and independent sector bests', () => {
    const storage = new MemoryStorage();
    saveTimeTrialLap(storage, 'pitwall-gp', 24.2, [8.2, 8.0, 8.0]);
    const record = saveTimeTrialLap(storage, 'pitwall-gp', 24.4, [8.0, 8.3, 8.1]);

    expect(record.bestLap).toBeCloseTo(24.2, 6);
    expect(record.bestSectors[0]).toBeCloseTo(8.0, 6);
    expect(record.bestSectors[1]).toBeCloseTo(8.0, 6);
    expect(record.bestSectors[2]).toBeCloseTo(8.0, 6);
    expect(record.laps[0].lapTime).toBeCloseTo(24.2, 6);
    expect(loadTimeTrialRecord(storage, 'pitwall-gp').laps).toHaveLength(2);
  });
});
