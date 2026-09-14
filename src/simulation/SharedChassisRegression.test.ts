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
    const pose = sampleTrack(0.18, 0);
    const start = { ...createVehicle(pose.x, pose.y, pose.heading), speed: 58 };
    driver.progress = 0.18;
    driver.lap = 1;
    driver.laneOffset = 0;

    const physics = new RapierRacePhysics(start, [driver]);
    physics.setPlayerState(start);
    physics.setAiState(0, start);

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
    expect(ai.speed).toBeCloseTo(player.speed, 5);
    expect(ai.heading).toBeCloseTo(player.heading, 5);
    expect(ai.yawRate).toBeCloseTo(player.yawRate, 5);
    expect(Math.hypot(ai.x - player.x, ai.y - player.y)).toBeLessThan(0.02);
  });
});
