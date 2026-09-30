import { describe, expect, it } from 'vitest';
import { loadTimeTrialRecord, saveTimeTrialLap } from './TimeTrialRecordStore';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

describe('TimeTrialRecordStore', () => {
  it('treats pre-revision and stale-geometry records as empty', () => {
    const storage = new MemoryStorage();
    const payload = {
      bestLap: 24.2,
      bestSectors: [8.0, 8.0, 8.2],
      laps: [{ lapTime: 24.2, sectors: [8.0, 8.0, 8.2], recordedAt: 1 }],
    };

    storage.setItem('pitwall-racer:time-trial:v1:pitwall-gp', JSON.stringify(payload));
    expect(loadTimeTrialRecord(storage, 'pitwall-gp').bestLap).toBeUndefined();

    storage.setItem('pitwall-racer:time-trial:v1:pitwall-gp', JSON.stringify({
      ...payload,
      trackRevision: 'g1-stale',
    }));
    expect(loadTimeTrialRecord(storage, 'pitwall-gp').laps).toEqual([]);
  });

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
