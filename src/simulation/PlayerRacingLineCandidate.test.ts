import { describe, expect, it } from 'vitest';
import {
  PlayerRacingLineCandidateRecorder,
  loadPlayerRacingLineCandidate,
  saveBestPlayerRacingLineCandidate,
  racingLineTraceQuality,
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
    expect(candidate?.points).toHaveLength(320);
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
  it('stores shared-chassis forward acceleration when provided', () => {
    const recorder = new PlayerRacingLineCandidateRecorder();
    recorder.begin('pitwall-gp', 1.2);
    for (let index = 0; index < 360; index++) {
      const progress = index / 360;
      recorder.sample(
        progress,
        0,
        55,
        0,
        0,
        1 / 120,
        1.2,
        3.25,
      );
    }
    const candidate = recorder.finish(25);
    expect(candidate).toBeDefined();
    expect(candidate?.points.some(
      (point) => point.forwardAcceleration !== undefined,
    )).toBe(true);
    expect(candidate?.points[120]?.forwardAcceleration).toBeCloseTo(3.25, 2);
    expect(candidate?.points.every(
      (point) => point.worldX !== undefined && point.worldY !== undefined,
    )).toBe(true);
    expect(candidate?.points.every((point) => point.bodyHeading !== undefined)).toBe(true);
    expect(racingLineTraceQuality(candidate)).toBe(5);
  });

  it('resamples absolute pose continuously across the start/finish seam', () => {
    const recorder = new PlayerRacingLineCandidateRecorder();
    recorder.begin('pitwall-gp', 1.2);
    for (let index = 0; index < 480; index++) {
      const progress = index / 480;
      recorder.sample(
        progress,
        5 + Math.sin(progress * Math.PI * 2) * 0.5,
        70,
        0.12,
        0.4,
        1 / 120,
        1.2,
        4,
      );
    }
    const candidate = recorder.finish(23);
    expect(candidate).toBeDefined();
    const first = candidate!.points[0];
    const last = candidate!.points[candidate!.points.length - 1];
    expect(first.worldX).toBeDefined();
    expect(last.worldX).toBeDefined();
    expect(Math.hypot(first.worldX! - last.worldX!, first.worldY! - last.worldY!)).toBeLessThan(8);
    expect(first.bodyHeading).toBeDefined();
    expect(last.bodyHeading).toBeDefined();
  });

  it('stores demonstrated longitudinal acceleration when samples include dt', () => {
    const recorder = new PlayerRacingLineCandidateRecorder();
    recorder.begin('pitwall-gp', 1.2);
    for (let index = 0; index < 360; index++) {
      const progress = index / 360;
      recorder.sample(
        progress,
        0,
        40 + progress * 20,
        0,
        0,
        1 / 120,
        1.18 + progress * 0.03,
      );
    }
    const candidate = recorder.finish(25);
    expect(candidate).toBeDefined();
    expect(candidate?.points.some(
      (point) => point.longitudinalAcceleration !== undefined,
    )).toBe(true);
    expect(candidate?.points.some(
      (point) => point.tireGrip !== undefined,
    )).toBe(true);
  });

  it('never replaces a richer trace with a faster lower-fidelity lap', () => {
    const storage = new MemoryStorage();
    const base = recordedLap(24.2, true)!;
    const rich = {
      ...base,
      points: base.points.map((point) => ({
        ...point,
        longitudinalAcceleration: 0,
        tireGrip: 1.2,
        forwardAcceleration: 2.5,
      })),
    };
    const lowerFidelityFast = recordedLap(23.4, true)!;

    saveBestPlayerRacingLineCandidate(storage, rich);
    saveBestPlayerRacingLineCandidate(storage, lowerFidelityFast);

    const stored = loadPlayerRacingLineCandidate(storage, 'pitwall-gp');
    expect(stored?.lapSeconds).toBe(24.2);
    expect(racingLineTraceQuality(stored)).toBe(5);
  });

  it('keeps the faster lap when trace quality is equal', () => {
    const storage = new MemoryStorage();
    const makeRich = (seconds: number) => {
      const base = recordedLap(seconds, true)!;
      return {
        ...base,
        points: base.points.map((point) => ({
          ...point,
          longitudinalAcceleration: 0,
          tireGrip: 1.2,
          forwardAcceleration: 2.5,
        })),
      };
    };

    saveBestPlayerRacingLineCandidate(storage, makeRich(24.2));
    saveBestPlayerRacingLineCandidate(storage, makeRich(23.6));

    expect(loadPlayerRacingLineCandidate(storage, 'pitwall-gp')?.lapSeconds).toBe(23.6);
  });

});
