import RAPIER from '@dimforge/rapier2d-compat';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AiReferenceGhost } from './AiReferenceGhost';
import { PlayerRacingLineCandidateRecorder } from './PlayerRacingLineCandidate';
import { referenceRacingLineAsset } from './ReferenceDriverModel';
import {
  projectRuntimeRacingLineNear,
  setRuntimeRacingLine,
} from './RacingLineRuntime';
import { projectTrackNear, setActiveTrack } from './TrackModel';

afterEach(() => {
  setRuntimeRacingLine('pitwall-gp', undefined);
  setActiveTrack('pitwall-gp');
});

describe('AiReferenceGhost', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('replays at the grip under which the PLAYER line was demonstrated', () => {
    setActiveTrack('pitwall-gp');
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: 1.225,
      points: Array.from({ length: 160 }, (_, index) => ({
        progress: index / 160,
        laneOffset: 0,
        targetSpeed: 65,
        headingOffset: 0,
        yawRate: 0,
      })),
    });

    const ghost = new AiReferenceGhost(0.2, 'pitwall-gp');
    expect(ghost.driver.tire.grip).toBeCloseTo(1.225, 6);
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
  it('replays a physically demonstrated lap close to the path that produced it', () => {
    setActiveTrack('pitwall-gp');
    setRuntimeRacingLine('pitwall-gp', undefined);

    const source = new AiReferenceGhost(0.01, 'pitwall-gp');
    const recorder = new PlayerRacingLineCandidateRecorder();
    recorder.begin('pitwall-gp', source.driver.tire.grip);
    let elapsed = 0;
    let previousProgress = 0.01;
    let recordedLapSeconds = 0;

    for (let tick = 0; tick < 45 * 120; tick++) {
      source.step(1 / 120);
      elapsed += 1 / 120;
      const state = source.state();
      if (!state) continue;
      const projection = projectTrackNear(
        state.x,
        state.y,
        source.driver.progress,
      );
      recorder.sample(
        projection.progress,
        projection.laneOffset,
        state.speed,
        wrapAngle(state.heading - projection.heading),
        state.yawRate,
      );
      if (previousProgress > 0.90 && projection.progress < 0.10) {
        recordedLapSeconds = elapsed;
        break;
      }
      previousProgress = projection.progress;
    }

    const candidate = recorder.finish(recordedLapSeconds);
    expect(candidate).toBeDefined();
    setRuntimeRacingLine('pitwall-gp', candidate);

    const replay = new AiReferenceGhost(0.01, 'pitwall-gp');
    let replayElapsed = 0;
    let replayPreviousProgress = 0.01;
    let replayLapSeconds = 0;
    let maxPathError = 0;
    let errorSum = 0;
    let samples = 0;

    for (let tick = 0; tick < 45 * 120; tick++) {
      replay.step(1 / 120);
      replayElapsed += 1 / 120;
      const state = replay.state();
      if (!state) continue;
      const projection = projectTrackNear(
        state.x,
        state.y,
        replay.driver.progress,
      );
      const lineProjection = projectRuntimeRacingLineNear(
        'pitwall-gp',
        state.x,
        state.y,
        projection.progress,
      );
      maxPathError = Math.max(maxPathError, lineProjection.distance);
      errorSum += lineProjection.distance;
      samples += 1;
      if (replayPreviousProgress > 0.90 && projection.progress < 0.10) {
        replayLapSeconds = replayElapsed;
        break;
      }
      replayPreviousProgress = projection.progress;
    }

    console.info('DEMONSTRATED_REPLAY_METRICS', {
      recordedLapSeconds,
      replayLapSeconds,
      maxPathError,
      avgPathError: samples > 0 ? errorSum / samples : 0,
    });

    expect(replayLapSeconds).toBeGreaterThan(0);
    expect(replayLapSeconds).toBeLessThan(recordedLapSeconds * 1.05);
    expect(maxPathError).toBeLessThan(1.8);
  }, 15_000);

  it('keeps a legacy position+speed PLAYER line physically recoverable', () => {
    setActiveTrack('pitwall-gp');
    const machine = referenceRacingLineAsset('pitwall-gp', 1.1);
    setRuntimeRacingLine('pitwall-gp', {
      ...machine,
      source: 'PLAYER',
      // Old saved candidates have no demonstrated heading/yaw state. Keep a
      // regression for that fallback path while new recordings use the richer
      // physically demonstrated controller tested above.
      points: machine.points.map((point) => ({
        progress: point.progress,
        laneOffset: point.laneOffset,
        targetSpeed: point.targetSpeed,
      })),
    });

    // Start just before the line so the ghost arms its timed lap almost
    // immediately instead of spending a whole untimed lap before measurement.
    const ghost = new AiReferenceGhost(0.95, 'pitwall-gp');
    let maxLaneError = 0;
    let maxTrackDistance = 0;

    for (let tick = 0; tick < 45 * 120; tick++) {
      ghost.step(1 / 120);
      const state = ghost.state();
      if (!state) continue;
      const projection = projectTrackNear(
        state.x,
        state.y,
        ghost.driver.progress,
      );
      const lineProjection = projectRuntimeRacingLineNear(
        'pitwall-gp',
        state.x,
        state.y,
        projection.progress,
      );
      const laneError = lineProjection.distance;
      maxLaneError = Math.max(maxLaneError, laneError);
      maxTrackDistance = Math.max(maxTrackDistance, projection.distance);
      if (ghost.lastLapSeconds() !== undefined) break;
    }

    console.info('LEGACY_REPLAY_METRICS', {
      lastLapSeconds: ghost.lastLapSeconds(),
      maxLaneError,
      maxTrackDistance,
    });
    expect(ghost.lastLapSeconds()).toBeDefined();
    // Legacy position+speed assets remain a migration fallback. New PLAYER
    // recordings are held to the much tighter 1.8 m demonstrated-state test
    // above and replace a legacy candidate after one clean lap.
    expect(maxLaneError).toBeLessThan(8.0);
  }, 15_000);

function wrapAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

});
