import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { WORLD_SCALE } from '../rendering3d/WorldTransform';
import { dynamicAiControl } from './DynamicAiController';
import { PLAYER_GRID } from './GridModel';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField, type DriverState, type RaceTrafficCar } from './RaceModel';
import { createTire } from './TireModel';
import { projectTrack, sampleTrack, TRACK_LENGTH } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;
const CAMERA_VIEW_HEIGHT = 43;

describe('dynamic field playtest telemetry', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('runs a physical pack and emits balance/perception telemetry', () => {
    const ai = createAiField();
    const start = sampleTrack(PLAYER_GRID.progress, PLAYER_GRID.laneOffset);
    const physics = new RapierRacePhysics(createVehicle(start.x, start.y, start.heading), ai);
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
    let offTrackSamples = 0;
    const jerkSamples: number[] = [];
    const lastAiSpeeds = ai.map(() => 0);

    for (let tick = 0; tick < 30 / DT; tick++) {
      const player = physics.playerState();
      const playerProjection = projectTrack(player.x, player.y);
      if (lastPlayerProgress > 0.88 && playerProjection.progress < 0.12) playerLap += 1;
      lastPlayerProgress = playerProjection.progress;
      playerDriver.progress = playerProjection.progress;
      playerDriver.lap = playerLap;
      playerDriver.speed = player.speed;

      const aiStates = physics.aiStates();
      const traffic: RaceTrafficCar[] = [
        {
          id: 'player',
          lap: playerLap,
          progress: playerProjection.progress,
          speed: player.speed,
          laneOffset: playerProjection.laneOffset,
          performance: 1,
          isPlayer: true,
        },
        ...aiStates.map((state, index) => {
          const p = projectTrack(state.x, state.y);
          return {
            id: ai[index].id,
            lap: ai[index].lap,
            progress: p.progress,
            speed: state.speed,
            laneOffset: p.laneOffset,
            performance: ai[index].skill * ai[index].tire.grip,
          };
        }),
      ];

      const playerControl = dynamicAiControl(playerDriver, player, traffic);
      const deployWindow = tick > 12 / DT && tick < 18 / DT;
      physics.drivePlayer({
        throttle: playerControl.throttle,
        brake: playerControl.brake,
        steer: playerControl.steer,
        tireGrip: playerDriver.tire.grip,
        surfaceGrip: 1,
        powerBoost: deployWindow ? 0.38 : 0.075,
        powerMultiplier: 1,
        rollingResistance: 0,
      }, DT);

      physics.syncAiKinematics(ai, DT, playerLap);
      physics.step(DT);

      const nextPlayer = physics.playerState();
      const nextAi = physics.aiStates();
      maxPlayerSpeed = Math.max(maxPlayerSpeed, nextPlayer.speed);
      playerSpeedSum += nextPlayer.speed;

      nextAi.forEach((state, index) => {
        maxAiSpeed = Math.max(maxAiSpeed, state.speed);
        aiSpeedSum += state.speed;
        const jerk = Math.abs(state.speed - lastAiSpeeds[index]) / DT;
        if (tick > 60) {
          aiJerkSum += jerk;
          aiJerkSamples += 1;
          jerkSamples.push(jerk);
          maxAiJerk = Math.max(maxAiJerk, jerk);
        }
        lastAiSpeeds[index] = state.speed;
        if (projectTrack(state.x, state.y).distance > 42) offTrackSamples += 1;
      });

      const all = [nextPlayer, ...nextAi];
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          minPairDistance = Math.min(minPairDistance, Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y));
        }
      }
      samples += 1;
    }

    const orderedJerk = [...jerkSamples].sort((a, b) => a - b);
    const p99AiJerk = percentile(orderedJerk, 0.99);
    const highJerkRatio = jerkSamples.filter((value) => value > 60).length / Math.max(1, jerkSamples.length);
    const metrics = {
      maxPlayerKmh: Math.round(maxPlayerSpeed * 3.6),
      avgPlayerKmh: Math.round((playerSpeedSum / samples) * 3.6),
      maxAiKmh: Math.round(maxAiSpeed * 3.6),
      avgAiKmh: Math.round((aiSpeedSum / Math.max(1, samples * ai.length)) * 3.6),
      minPairDistance: Number(minPairDistance.toFixed(2)),
      avgAiLongitudinalJerk: Number((aiJerkSum / Math.max(1, aiJerkSamples)).toFixed(2)),
      p99AiLongitudinalJerk: Number(p99AiJerk.toFixed(2)),
      highJerkRatio: Number(highJerkRatio.toFixed(4)),
      maxAiLongitudinalJerk: Number(maxAiJerk.toFixed(2)),
      offTrackRatio: Number((offTrackSamples / Math.max(1, samples * ai.length)).toFixed(4)),
      peakViewportHeightsPerSecond: Number((maxPlayerSpeed * WORLD_SCALE / CAMERA_VIEW_HEIGHT).toFixed(3)),
      trackLength: Math.round(TRACK_LENGTH),
    };

    console.log(`PLAYTEST_METRICS ${JSON.stringify(metrics)}`);

    expect(metrics.maxPlayerKmh).toBeGreaterThanOrEqual(315);
    expect(metrics.maxPlayerKmh).toBeLessThan(410);
    // The user should be chasing this field, not cruising past it. This is a
    // deliberately aggressive gate: even a simulated Medium player gets a six
    // second DEPLOY window and the AI field still needs materially more pace.
    expect(metrics.maxAiKmh).toBeGreaterThan(345);
    expect(metrics.maxAiKmh).toBeLessThan(410);
    expect(metrics.avgAiKmh).toBeGreaterThan(metrics.avgPlayerKmh + 15);
    expect(metrics.offTrackRatio).toBeLessThan(0.035);
    expect(metrics.peakViewportHeightsPerSecond).toBeGreaterThan(0.60);
    expect(metrics.avgAiLongitudinalJerk).toBeLessThan(10);
    expect(metrics.p99AiLongitudinalJerk).toBeLessThan(25);
    expect(metrics.highJerkRatio).toBeLessThan(0.009);
  }, 20_000);
});

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * quantile)));
  return sorted[index];
}
