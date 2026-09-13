import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { WORLD_SCALE } from '../rendering3d/WorldTransform';
import { dynamicAiControl } from './DynamicAiController';
import { PLAYER_GRID } from './GridModel';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField, type DriverState } from './RaceModel';
import { surfaceEffect } from './SurfaceModel';
import { DEEP_CUT_DISTANCE } from './TrackLimitsModel';
import { createTire } from './TireModel';
import { projectTrackNear, sampleTrack, TRACK_LENGTH } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;
const CAMERA_VIEW_HEIGHT = 39;
const CORE_POWER_BOOST = 0.22;

describe('dynamic field playtest telemetry', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('keeps player baseline pace and the physical AI pack fast without energy deployment', () => {
    const ai = createAiField();

    // Keep the AI pack physical in one world, while an identical isolated car
    // supplies a stable pace baseline. Both sides must use the same surface
    // penalties; otherwise an autonomous proxy can cut grass at asphalt grip
    // and create a meaningless benchmark once track limits become physical.
    const remote = sampleTrack(0.5, 260);
    const aiPhysics = new RapierRacePhysics(createVehicle(remote.x, remote.y, remote.heading), ai);

    const start = sampleTrack(PLAYER_GRID.progress, PLAYER_GRID.laneOffset);
    const playerPhysics = new RapierRacePhysics(createVehicle(start.x, start.y, start.heading), []);
    const playerDriver: DriverState = {
      ...createAiField()[1],
      id: 'player',
      name: 'YOU',
      progress: PLAYER_GRID.progress,
      lap: 0,
      speed: 0,
      tire: createTire('MEDIUM'),
      usedCompounds: new Set(['MEDIUM']),
      preferredLane: 0,
      skill: 1.06,
    };

    let playerLap = 0;
    let lastPlayerProgress = PLAYER_GRID.progress;
    let maxPlayerSpeed = 0;
    let maxAiSpeed = 0;
    let playerSpeedSum = 0;
    let aiSpeedSum = 0;
    let samples = 0;
    let minPairDistance = Number.POSITIVE_INFINITY;
    let aiJerkSum = 0;
    let aiJerkSamples = 0;
    let maxAiJerk = 0;
    let deepCutSamples = 0;
    const jerkSamples: number[] = [];
    const lastAiSpeeds = ai.map(() => 0);
    const perAiSpeedSum = ai.map(() => 0);
    const perAiMaxSpeed = ai.map(() => 0);
    const perAiDeepCut = ai.map(() => 0);

    for (let tick = 0; tick < 30 / DT; tick++) {
      const player = playerPhysics.playerState();
      const playerProjection = projectTrackNear(player.x, player.y, lastPlayerProgress);
      if (lastPlayerProgress > 0.88 && playerProjection.progress < 0.12) playerLap += 1;
      lastPlayerProgress = playerProjection.progress;
      playerDriver.progress = playerProjection.progress;
      playerDriver.lap = playerLap;
      playerDriver.speed = player.speed;

      const playerControl = dynamicAiControl(playerDriver, player, []);
      const playerSurface = surfaceEffect(playerProjection.distance);
      playerPhysics.drivePlayer({
        throttle: playerControl.throttle,
        brake: playerControl.brake,
        steer: playerControl.steer,
        tireGrip: playerDriver.tire.grip,
        surfaceGrip: playerSurface.gripMultiplier,
        powerBoost: CORE_POWER_BOOST,
        powerMultiplier: playerSurface.powerMultiplier,
        rollingResistance: playerSurface.rollingResistance,
      }, DT);
      playerPhysics.step(DT);

      aiPhysics.syncAiKinematics(ai, DT, -10);
      aiPhysics.step(DT);

      const nextPlayer = playerPhysics.playerState();
      const nextAi = aiPhysics.aiStates();
      maxPlayerSpeed = Math.max(maxPlayerSpeed, nextPlayer.speed);
      playerSpeedSum += nextPlayer.speed;

      nextAi.forEach((state, index) => {
        maxAiSpeed = Math.max(maxAiSpeed, state.speed);
        aiSpeedSum += state.speed;
        perAiSpeedSum[index] += state.speed;
        perAiMaxSpeed[index] = Math.max(perAiMaxSpeed[index], state.speed);
        const jerk = Math.abs(state.speed - lastAiSpeeds[index]) / DT;
        if (tick > 60) {
          aiJerkSum += jerk;
          aiJerkSamples += 1;
          jerkSamples.push(jerk);
          maxAiJerk = Math.max(maxAiJerk, jerk);
        }
        lastAiSpeeds[index] = state.speed;
        if (projectTrackNear(state.x, state.y, ai[index].progress).distance > DEEP_CUT_DISTANCE) {
          deepCutSamples += 1;
          perAiDeepCut[index] += 1;
        }
      });

      for (let i = 0; i < nextAi.length; i++) {
        for (let j = i + 1; j < nextAi.length; j++) {
          minPairDistance = Math.min(
            minPairDistance,
            Math.hypot(nextAi[i].x - nextAi[j].x, nextAi[i].y - nextAi[j].y),
          );
        }
      }
      samples += 1;
    }

    const orderedJerk = [...jerkSamples].sort((a, b) => a - b);
    const p99AiJerk = percentile(orderedJerk, 0.99);
    const highJerkRatio = jerkSamples.filter((value) => value > 60).length / Math.max(1, jerkSamples.length);
    const avgPlayerKmh = Math.round((playerSpeedSum / samples) * 3.6);
    const avgAiKmh = Math.round((aiSpeedSum / Math.max(1, samples * ai.length)) * 3.6);
    const estimatedLapSeconds = TRACK_LENGTH / Math.max(1, avgPlayerKmh / 3.6);
    const perAi = ai.map((driver, index) => ({
      name: driver.name,
      avgKmh: Math.round((perAiSpeedSum[index] / Math.max(1, samples)) * 3.6),
      maxKmh: Math.round(perAiMaxSpeed[index] * 3.6),
      deepCutRatio: Number((perAiDeepCut[index] / Math.max(1, samples)).toFixed(3)),
      lap: driver.lap,
      progress: Number(driver.progress.toFixed(3)),
    }));
    const metrics = {
      maxPlayerKmh: Math.round(maxPlayerSpeed * 3.6),
      avgPlayerKmh,
      maxAiKmh: Math.round(maxAiSpeed * 3.6),
      avgAiKmh,
      estimatedLapSeconds: Number(estimatedLapSeconds.toFixed(1)),
      minPairDistance: Number(minPairDistance.toFixed(2)),
      avgAiLongitudinalJerk: Number((aiJerkSum / Math.max(1, aiJerkSamples)).toFixed(2)),
      p99AiLongitudinalJerk: Number(p99AiJerk.toFixed(2)),
      highJerkRatio: Number(highJerkRatio.toFixed(4)),
      maxAiLongitudinalJerk: Number(maxAiJerk.toFixed(2)),
      deepCutRatio: Number((deepCutSamples / Math.max(1, samples * ai.length)).toFixed(4)),
      peakViewportHeightsPerSecond: Number((maxPlayerSpeed * WORLD_SCALE / CAMERA_VIEW_HEIGHT).toFixed(3)),
      trackLength: Math.round(TRACK_LENGTH),
      perAi,
    };

    console.log(`PLAYTEST_METRICS ${JSON.stringify(metrics)}`);

    expect(metrics.trackLength).toBeGreaterThan(1800);
    expect(metrics.trackLength).toBeLessThan(2400);
    expect(metrics.estimatedLapSeconds).toBeLessThan(42);
    expect(metrics.maxPlayerKmh).toBeGreaterThanOrEqual(270);
    expect(metrics.maxPlayerKmh).toBeLessThan(390);
    expect(metrics.maxAiKmh).toBeGreaterThan(285);
    expect(metrics.maxAiKmh).toBeLessThan(400);
    expect(metrics.avgPlayerKmh).toBeGreaterThan(185);
    expect(metrics.avgAiKmh).toBeGreaterThan(195);
    expect(metrics.avgAiKmh).toBeGreaterThanOrEqual(metrics.avgPlayerKmh - 12);
    expect(metrics.deepCutRatio).toBeLessThan(0.12);
    expect(metrics.peakViewportHeightsPerSecond).toBeGreaterThan(0.75);
    expect(metrics.avgAiLongitudinalJerk).toBeLessThan(10);
    expect(metrics.p99AiLongitudinalJerk).toBeLessThan(48);
    expect(metrics.highJerkRatio).toBeLessThan(0.008);
  }, 20_000);
});

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * quantile)));
  return sorted[index];
}
