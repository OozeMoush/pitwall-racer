import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField } from './RaceModel';
import { sampleTrack } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;

describe('shared player/AI chassis', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('produces the same motion for identical inputs instead of giving AI hidden power or grip', () => {
    const driver = createAiField()[0];
    const playerPose = sampleTrack(0.18, -8);
    const aiPose = sampleTrack(0.18, 8);
    const playerStart = { ...createVehicle(playerPose.x, playerPose.y, playerPose.heading), speed: 58 };
    const aiStart = { ...createVehicle(aiPose.x, aiPose.y, aiPose.heading), speed: 58 };
    driver.progress = 0.18;
    driver.lap = 1;
    driver.laneOffset = 8;

    // Keep the bodies physically separated so the comparison measures the
    // chassis response rather than a player/AI contact impulse.
    const physics = new RapierRacePhysics(playerStart, [driver]);
    physics.setPlayerState(playerStart);
    physics.setAiState(0, aiStart);

    const input = {
      throttle: 0.72,
      brake: 0,
      steer: 0.18,
      tireGrip: 1.06,
      tireWear: 0,
      surfaceGrip: 1,
      powerBoost: 0.22,
      powerMultiplier: 1,
      rollingResistance: 0,
    };

    for (let tick = 0; tick < 0.8 / DT; tick++) {
      physics.drivePlayer(input, DT);
      physics.driveAi(0, input, DT);
      physics.step(DT);
    }

    const player = physics.playerState();
    const ai = physics.aiStates()[0];
    expect(Math.abs(ai.speed - player.speed)).toBeLessThan(0.002);
    expect(Math.abs(ai.heading - player.heading)).toBeLessThan(0.0002);
    expect(Math.abs(ai.yawRate - player.yawRate)).toBeLessThan(0.0002);
  });
});
