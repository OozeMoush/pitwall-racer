import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { WORLD_SCALE } from '../rendering3d/WorldTransform';
import { dynamicAiControl } from './DynamicAiController';
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
    const start = sampleTrack(0);
    const physics = new RapierRacePhysics(createVehicle(start.x, start.y, start.heading), ai);
    const playerDriver: DriverState = {
      ...createAiField()[1],
      id: 'player',
      name: 'YOU',
      progress: 0,
      lap: 1,
      speed: 0,
      tire: createTire('MEDIUM'),
      usedCompounds: new Set(['MEDIUM']),
      preferredLane: 0,
    };

    let playerLap = 1;
    let lastPlayerProgress = 0;
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
      physics.drivePlayer({
        throttle: playerControl.throttle,
        brake: playerControl.brake,
        steer: playerControl.steer,
        tireGrip: playerDriver.tire.grip,
        surfaceGrip: 1,
        powerBoost: tick > 12 / DT && tick < 18 / DT ? 0.22 : 0.065,
        powerMultiplier: 1,
        rollingResistance: 0,
      }, DT);

      physics.syncAiKinematics(ai, DT);
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
          maxAiJerk = Math.max(maxAiJerk, jerk);
        }
        lastAiSpeeds[index] = state.speed;
        if (projectTrack(state.x, state.y).distance > 90) offTrackSamples += 1;
      });

      const all = [nextPlayer, ...nextAi];
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          minPairDistance = Math.min(minPairDistance, Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y));
        }
      }
      samples += 1;
    }

    const metrics = {
      maxPlayerKmh: Math.round(maxPlayerSpeed * 3.6),
      avgPlayerKmh: Math.round((playerSpeedSum / samples) * 3.6),
      maxAiKmh: Math.round(maxAiSpeed * 3.6),
      avgAiKmh: Math.round((aiSpeedSum / Math.max(1, samples * ai.length)) * 3.6),
      minPairDistance: Number(minPairDistance.toFixed(2)),
      avgAiLongitudinalJerk: Number((aiJerkSum / Math.max(1, aiJerkSamples)).toFixed(2)),
      maxAiLongitudinalJerk: Number(maxAiJerk.toFixed(2)),
      offTrackRatio: Number((offTrackSamples / Math.max(1, samples * ai.length)).toFixed(4)),
      peakViewportHeightsPerSecond: Number((maxPlayerSpeed * WORLD_SCALE / CAMERA_VIEW_HEIGHT).toFixed(3)),
      trackLength: Math.round(TRACK_LENGTH),
    };

    console.log(`PLAYTEST_METRICS ${JSON.stringify(metrics)}`);

    expect(metrics.maxPlayerKmh).toBeGreaterThan(260);
    expect(metrics.maxAiKmh).toBeGreaterThan(220);
    expect(metrics.maxAiKmh).toBeLessThan(410);
    expect(metrics.offTrackRatio).toBeLessThan(0.2);
    expect(metrics.peakViewportHeightsPerSecond).toBeGreaterThan(0.4);
  }, 20_000);
});
