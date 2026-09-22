import RAPIER from '@dimforge/rapier2d-compat';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AiReferenceGhost } from './AiReferenceGhost';
import { PlayerRacingLineCandidateRecorder } from './PlayerRacingLineCandidate';
import { referenceRacingLineAsset } from './ReferenceDriverModel';
import {
  activeReferenceTarget,
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

    console.info('DEMONSTRATED_REPLAY_DIAGNOSTIC', {
      recordedLapSeconds,
      replayLapSeconds,
      maxPathError,
      avgPathError: samples > 0 ? errorSum / samples : 0,
    });

    expect(replayLapSeconds).toBeGreaterThan(0);
    expect(replayLapSeconds).toBeLessThan(recordedLapSeconds * 1.18);
    expect(maxPathError).toBeLessThan(3.2);
  });

  it('can physically replay a near-limit reference when exposed as PLAYER data', () => {
    setActiveTrack('pitwall-gp');
    const machine = referenceRacingLineAsset('pitwall-gp', 1.1);
    setRuntimeRacingLine('pitwall-gp', {
      ...machine,
      source: 'PLAYER',
    });

    // Start just before the line so the ghost arms its timed lap almost
    // immediately instead of spending a whole untimed lap before measurement.
    const ghost = new AiReferenceGhost(0.95, 'pitwall-gp');
    let maxLaneError = 0;
    let maxTrackDistance = 0;
    let lastProgress = ghost.driver.progress;
    let maxErrorSnapshot: unknown;
    const bins = Array.from({ length: 20 }, () => ({
      samples: 0,
      pathError: 0,
      maxPathError: 0,
      speed: 0,
      targetSpeed: 0,
      steer: 0,
      brake: 0,
      headingError: 0,
      yawError: 0,
    }));

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
      const reference = activeReferenceTarget(
        'pitwall-gp',
        lineProjection.progress,
        ghost.driver.tire.grip,
      );
      const laneError = lineProjection.distance;
      const control = ghost.latestControl();
      const bin = bins[Math.min(
        bins.length - 1,
        Math.floor(lineProjection.progress * bins.length),
      )];
      bin.samples += 1;
      bin.pathError += laneError;
      bin.maxPathError = Math.max(bin.maxPathError, laneError);
      bin.speed += state.speed;
      bin.targetSpeed += control?.targetSpeed ?? 0;
      bin.steer += Math.abs(control?.steer ?? 0);
      bin.brake += control?.brake ?? 0;
      bin.headingError += Math.abs(control?.debug.pathHeadingError ?? 0);
      bin.yawError += Math.abs(
        (control?.debug.targetYawRate ?? state.yawRate) - state.yawRate,
      );

      if (laneError > maxLaneError) {
        maxLaneError = laneError;
        maxErrorSnapshot = {
          tick,
          centreProgress: projection.progress,
          pathProgress: lineProjection.progress,
          actualLane: projection.laneOffset,
          referenceLane: reference.laneOffset,
          pathDistance: lineProjection.distance,
          trackDistance: projection.distance,
          speedKmh: state.speed * 3.6,
          heading: state.heading,
          yawRate: state.yawRate,
          control: ghost.latestControl()
            ? {
                steer: ghost.latestControl()!.steer,
                brake: ghost.latestControl()!.brake,
                throttle: ghost.latestControl()!.throttle,
                targetSpeed: ghost.latestControl()!.targetSpeed,
                debug: {
                  lineSource: ghost.latestControl()!.debug.lineSource,
                  laneError: ghost.latestControl()!.debug.laneError,
                  pathHeadingError: ghost.latestControl()!.debug.pathHeadingError,
                  bearingError: ghost.latestControl()!.debug.bearingError,
                  targetYawRate: ghost.latestControl()!.debug.targetYawRate,
                  demonstratedDynamics: ghost.latestControl()!.debug.demonstratedDynamics,
                },
              }
            : undefined,
        };
      }
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
      maxErrorSnapshot,
      bins: bins.map((bin, index) => ({
        p: `${index * 5}-${(index + 1) * 5}%`,
        avgError: bin.samples > 0 ? bin.pathError / bin.samples : 0,
        maxError: bin.maxPathError,
        avgKmh: bin.samples > 0 ? bin.speed / bin.samples * 3.6 : 0,
        targetKmh: bin.samples > 0 ? bin.targetSpeed / bin.samples * 3.6 : 0,
        avgSteer: bin.samples > 0 ? bin.steer / bin.samples : 0,
        avgBrake: bin.samples > 0 ? bin.brake / bin.samples : 0,
        headingDeg: bin.samples > 0
          ? bin.headingError / bin.samples * 180 / Math.PI
          : 0,
        yawError: bin.samples > 0 ? bin.yawError / bin.samples : 0,
      })),
    });
    expect(ghost.lastLapSeconds()).toBeDefined();
    expect(maxLaneError).toBeLessThan(5.5);
  });

function wrapAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

});
