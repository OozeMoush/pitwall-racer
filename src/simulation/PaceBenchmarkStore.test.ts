import { describe, expect, it } from 'vitest';
import type { EmpiricalLapEvidence } from './PaceBenchmarkModel';
import { loadPaceEvidence, savePaceEvidence, type PaceEvidenceStorage } from './PaceBenchmarkStore';

class MemoryStorage implements PaceEvidenceStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function evidence(seconds: number): EmpiricalLapEvidence {
  return {
    trackId: 'pitwall-gp',
    seconds,
    compound: 'SOFT',
    startWear: 0.01,
    endWear: 0.08,
    deepCutRatio: 0,
    grassRatio: 0,
    maxTow: 0,
    launchAffected: false,
    recovered: false,
    pitted: false,
  };
}

describe('pace benchmark evidence storage', () => {
  it('persists fastest evidence first without losing slower diagnostic laps', () => {
    const storage = new MemoryStorage();
    savePaceEvidence(storage, evidence(26.2));
    savePaceEvidence(storage, evidence(24.4));

    expect(loadPaceEvidence(storage).map((lap) => lap.seconds)).toEqual([24.4, 26.2]);
  });

  it('ignores historical evidence without the current track revision', () => {
    const storage = new MemoryStorage();
    storage.setItem('pitwall-racer:pace-evidence:v1', JSON.stringify({
      version: 1,
      laps: [evidence(24.4)],
    }));
    expect(loadPaceEvidence(storage)).toEqual([]);

    storage.setItem('pitwall-racer:pace-evidence:v1', JSON.stringify({
      version: 1,
      laps: [{ ...evidence(24.4), trackRevision: 'g1-stale' }],
    }));
    expect(loadPaceEvidence(storage)).toEqual([]);
  });

  it('treats corrupt storage as empty instead of breaking startup', () => {
    const storage = new MemoryStorage();
    storage.setItem('pitwall-racer:pace-evidence:v1', '{broken');

    expect(loadPaceEvidence(storage)).toEqual([]);
  });
});
