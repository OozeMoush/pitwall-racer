import { describe, expect, it } from 'vitest';
import { RaceIntervalTracker, estimatedSignedGapSeconds, formatSignedRaceGap } from './RaceIntervalModel';

describe('RaceIntervalTracker', () => {
  it('reports a car ahead as a negative same-point time gap', () => {
    const tracker = new RaceIntervalTracker(100);
    const dt = 0.05;
    let player = { id: 'player', lap: 0, progress: 0.20 };
    let ahead = { id: 'ahead', lap: 0, progress: 0.25 };

    for (let time = 0; time <= 4; time += dt) {
      player = { ...player, progress: 0.20 + time * 0.10 };
      ahead = { ...ahead, progress: 0.20 + (time + 0.50) * 0.10 };
      tracker.update([player, ahead], time);
    }

    expect(tracker.gapSeconds(player, ahead)).toBeCloseTo(-0.50, 2);
  });

  it('reports a car behind as a positive same-point time gap', () => {
    const tracker = new RaceIntervalTracker(100);
    const dt = 0.05;
    let player = { id: 'player', lap: 0, progress: 0.24 };
    let behind = { id: 'behind', lap: 0, progress: 0.205 };

    for (let time = 0; time <= 4; time += dt) {
      player = { ...player, progress: 0.24 + time * 0.10 };
      behind = { ...behind, progress: 0.24 + (time - 0.35) * 0.10 };
      tracker.update([player, behind], time);
    }

    expect(tracker.gapSeconds(player, behind)).toBeCloseTo(0.35, 2);
  });

  it('formats F1-style signed thousandths and keeps an estimator for startup', () => {
    expect(formatSignedRaceGap(-0.417)).toBe('-0.417');
    expect(formatSignedRaceGap(1.234)).toBe('+1.234');
    expect(formatSignedRaceGap(0)).toBe('0.000');

    const player = { id: 'player', lap: 2, progress: 0.50 };
    const ahead = { id: 'ahead', lap: 2, progress: 0.51 };
    expect(estimatedSignedGapSeconds(player, ahead, 60)).toBeCloseTo(-0.6, 6);
  });
});
