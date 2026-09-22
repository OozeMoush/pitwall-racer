import { afterEach, describe, expect, it } from 'vitest';
import { AiReferenceGhost } from './AiReferenceGhost';
import { setRuntimeRacingLine } from './RacingLineRuntime';
import { setActiveTrack } from './TrackModel';

afterEach(() => {
  setRuntimeRacingLine('pitwall-gp', undefined);
  setActiveTrack('pitwall-gp');
});

describe('AiReferenceGhost', () => {
  it('runs the active PLAYER line with racecraft traffic removed', () => {
    setActiveTrack('pitwall-gp');
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: 1.1,
      points: Array.from({ length: 160 }, (_, index) => ({
        progress: index / 160,
        laneOffset: 0,
        targetSpeed: 65,
      })),
    });

    const ghost = new AiReferenceGhost(0.2, 'pitwall-gp');
    const initial = ghost.driver.progress;
    for (let tick = 0; tick < 240; tick++) ghost.step(1 / 120);

    const state = ghost.state();
    const control = ghost.latestControl();
    expect(state).toBeDefined();
    expect(control?.debug.lineSource).toBe('PLAYER');
    expect(control?.battleState).toBe('CLEAR');
    expect(Number.isFinite(state?.speed)).toBe(true);
    expect(Math.abs(ghost.driver.progress - initial)).toBeGreaterThan(0.01);
  });
});
