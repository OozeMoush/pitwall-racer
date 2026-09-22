import RAPIER from '@dimforge/rapier2d-compat';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AiReferenceGhost } from './AiReferenceGhost';
import { referenceRacingLineAsset } from './ReferenceDriverModel';
import { activeReferenceTarget, setRuntimeRacingLine } from './RacingLineRuntime';
import { projectTrackNear, setActiveTrack } from './TrackModel';

afterEach(() => {
  setRuntimeRacingLine('pitwall-gp', undefined);
  setActiveTrack('pitwall-gp');
});

describe('AiReferenceGhost', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

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
  it('can physically replay a near-limit reference when exposed as PLAYER data', () => {
    setActiveTrack('pitwall-gp');
    const machine = referenceRacingLineAsset('pitwall-gp', 1.1);
    setRuntimeRacingLine('pitwall-gp', {
      ...machine,
      source: 'PLAYER',
    });

    const ghost = new AiReferenceGhost(0.05, 'pitwall-gp');
    let maxLaneError = 0;
    let maxTrackDistance = 0;
    let lastProgress = ghost.driver.progress;

    for (let tick = 0; tick < 45 * 120; tick++) {
      ghost.step(1 / 120);
      const state = ghost.state();
      if (!state) continue;
      const projection = projectTrackNear(
        state.x,
        state.y,
        ghost.driver.progress,
      );
      const reference = activeReferenceTarget(
        'pitwall-gp',
        projection.progress,
        ghost.driver.tire.grip,
      );
      maxLaneError = Math.max(
        maxLaneError,
        Math.abs(reference.laneOffset - projection.laneOffset),
      );
      maxTrackDistance = Math.max(maxTrackDistance, projection.distance);
      lastProgress = projection.progress;
      if (ghost.lastLapSeconds() !== undefined) break;
    }

    console.info('EXPLICIT_REPLAY_DIAGNOSTIC', {
      lastLapSeconds: ghost.lastLapSeconds(),
      lastProgress,
      maxLaneError,
      maxTrackDistance,
      speedKmh: (ghost.state()?.speed ?? 0) * 3.6,
      control: ghost.latestControl(),
    });
    expect(ghost.lastLapSeconds()).toBeDefined();
    expect(maxLaneError).toBeLessThan(5.5);
  });

});
