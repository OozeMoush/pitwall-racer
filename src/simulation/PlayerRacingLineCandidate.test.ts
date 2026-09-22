import { describe, expect, it } from 'vitest';
import {
  PlayerRacingLineCandidateRecorder,
  loadPlayerRacingLineCandidate,
  saveBestPlayerRacingLineCandidate,
  type RacingLineCandidateStorage,
} from './PlayerRacingLineCandidate';

class MemoryStorage implements RacingLineCandidateStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function recordedLap(seconds: number, dynamics = false) {
  const recorder = new PlayerRacingLineCandidateRecorder();
  recorder.begin('pitwall-gp');
  for (let index = 0; index < 240; index++) {
    const progress = index / 240;
    recorder.sample(
      progress,
      Math.sin(progress * Math.PI * 2) * 3,
      50 + Math.cos(progress * Math.PI * 2) * 8,
      dynamics ? Math.sin(progress * Math.PI * 2) * 0.08 : undefined,
      dynamics ? Math.cos(progress * Math.PI * 2) * 0.45 : undefined,
    );
  }
  return recorder.finish(seconds);
}

describe('player racing-line candidates', () => {
  it('resamples a clean player lap into a compact racing-line asset', () => {
    const candidate = recordedLap(24.5);
    expect(candidate).toBeDefined();
    expect(candidate?.source).toBe('PLAYER');
    expect(candidate?.points).toHaveLength(160);
    expect(candidate?.points[0].progress).toBe(0);
    expect(candidate?.points.every((point) => Number.isFinite(point.targetSpeed))).toBe(true);
  });

  it('keeps the fastest clean candidate for each track', () => {
    const storage = new MemoryStorage();
    const fast = recordedLap(24.5);
    const slow = recordedLap(25.2);
    expect(fast).toBeDefined();
    expect(slow).toBeDefined();

    saveBestPlayerRacingLineCandidate(storage, fast!);
    saveBestPlayerRacingLineCandidate(storage, slow!);

    expect(loadPlayerRacingLineCandidate(storage, 'pitwall-gp')?.lapSeconds).toBe(24.5);
  });

  it('upgrades a legacy fastest line with demonstrated rotation state', () => {
    const storage = new MemoryStorage();
    const legacyFast = recordedLap(24.5);
    const enrichedSlow = recordedLap(25.0, true);
    expect(legacyFast).toBeDefined();
    expect(enrichedSlow).toBeDefined();

    saveBestPlayerRacingLineCandidate(storage, legacyFast!);
    saveBestPlayerRacingLineCandidate(storage, enrichedSlow!);

    const stored = loadPlayerRacingLineCandidate(storage, 'pitwall-gp');
    expect(stored?.lapSeconds).toBe(25.0);
    expect(stored?.points.every((point) => point.headingOffset !== undefined)).toBe(true);
    expect(stored?.points.every((point) => point.yawRate !== undefined)).toBe(true);

    const laterSlower = recordedLap(25.4, true);
    expect(laterSlower).toBeDefined();
    saveBestPlayerRacingLineCandidate(storage, laterSlower!);
    expect(loadPlayerRacingLineCandidate(storage, 'pitwall-gp')?.lapSeconds).toBe(25.0);
  });

  it('drops a lap explicitly marked ineligible', () => {
    const recorder = new PlayerRacingLineCandidateRecorder();
    recorder.begin('pitwall-gp');
    for (let index = 0; index < 240; index++) {
      recorder.sample(index / 240, 0, 50);
    }
    recorder.markIneligible();
    expect(recorder.finish(24.5)).toBeUndefined();
  });
});
