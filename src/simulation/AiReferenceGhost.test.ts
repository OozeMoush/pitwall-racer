import RAPIER from '@dimforge/rapier2d-compat';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AiReferenceGhost } from './AiReferenceGhost';
import { PlayerRacingLineCandidateRecorder } from './PlayerRacingLineCandidate';
import {
  projectRuntimeRacingLineNear,
  setRuntimeRacingLine,
} from './RacingLineRuntime';
import {
  crossedStartLine,
  projectTrackNear,
  sampleTrack,
  setActiveTrack,
} from './TrackModel';

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

  it('initializes velocity along the demonstrated world-path tangent', () => {
    setActiveTrack('pitwall-gp');
    const points = Array.from({ length: 320 }, (_, index) => {
      const progress = index / 320;
      const pose = sampleTrack(progress, 4);
      const next = sampleTrack((progress + 1 / 320) % 1, 4);
      const trajectoryHeading = Math.atan2(next.y - pose.y, next.x - pose.x);
      return {
        progress,
        laneOffset: 4,
        targetSpeed: 70,
        worldX: pose.x,
        worldY: pose.y,
        bodyHeading: trajectoryHeading + 0.16,
        headingOffset: 0.16,
        yawRate: 0,
      };
    });
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: 1.18,
      points,
    });

    const ghost = new AiReferenceGhost(0, 'pitwall-gp', true);
    const slip = ghost.latestSlipAngle();
    expect(slip).toBeDefined();
    expect(Math.abs(slip!)).toBeGreaterThan(0.08);
    expect(Math.abs(slip! - (ghost.sourceSlipAngle() ?? 0))).toBeLessThan(0.08);
  });

  it('can time one replay directly from the stored lap-start state', () => {
    setActiveTrack('pitwall-gp');
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: 1.18,
      points: Array.from({ length: 320 }, (_, index) => ({
        progress: index / 320,
        laneOffset: 0,
        targetSpeed: 70,
        yawRate: 0,
      })),
    });

    const ghost = new AiReferenceGhost(0, 'pitwall-gp', true);
    expect(ghost.warmupLapsRemaining()).toBe(0);
    expect(ghost.currentLapSeconds()).toBe(0);
    ghost.step(1 / 120);
    expect(ghost.currentLapSeconds()).toBeGreaterThan(0);
  });

  it('requires a full warmup lap before timed replay starts', () => {
    setActiveTrack('pitwall-gp');
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: 1.18,
      points: Array.from({ length: 320 }, (_, index) => ({
        progress: index / 320,
        laneOffset: 0,
        targetSpeed: 70,
      })),
    });

    const ghost = new AiReferenceGhost(0.75, 'pitwall-gp');
    expect(ghost.warmupLapsRemaining()).toBe(2);
    expect(ghost.currentLapSeconds()).toBeUndefined();

    let lastProgress = ghost.driver.progress;
    let wraps = 0;
    for (let tick = 0; tick < 55 * 120 && wraps < 2; tick++) {
      ghost.step(1 / 120);
      const progress = ghost.driver.progress;
      if (crossedStartLine(lastProgress, progress)) wraps += 1;
      lastProgress = progress;
      if (wraps === 1) {
        expect(ghost.currentLapSeconds()).toBeUndefined();
      }
    }

    expect(wraps).toBe(2);
    expect(ghost.warmupLapsRemaining()).toBe(0);
    expect(ghost.currentLapSeconds()).toBeDefined();
  }, 20_000);

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
    // Keep the guardrail at roughly one car-width; centimetre-scale replay
    // noise should not fail this integration test.
    expect(maxPathError).toBeLessThan(1.9);
  }, 15_000);

function wrapAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

  it('follows a demonstrated grip trace instead of freezing lap-start grip', () => {
    setActiveTrack('pitwall-gp');
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: 1.1,
      points: Array.from({ length: 160 }, (_, index) => ({
        progress: index / 160,
        laneOffset: 0,
        targetSpeed: 60,
        headingOffset: 0,
        yawRate: 0,
        longitudinalAcceleration: 0,
        tireGrip: 1.1 + index / 159 * 0.1,
      })),
    });

    const ghost = new AiReferenceGhost(0.5, 'pitwall-gp');
    const before = ghost.driver.tire.grip;
    for (let index = 0; index < 30; index++) ghost.step(1 / 120);
    expect(ghost.driver.tire.grip).not.toBeCloseTo(before, 6);
  });

});
