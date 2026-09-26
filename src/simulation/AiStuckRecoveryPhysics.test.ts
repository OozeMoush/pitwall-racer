import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField } from './RaceModel';
import { createTire } from './TireModel';
import { trackProfile } from './TrackProfile';
import { sampleTrack } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;

describe('physical AI stuck recovery', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('backs the AI away after a sustained physical stall', () => {
    const [driver] = createAiField();
    driver.tire = createTire('MEDIUM');

    const progress = fastestStraight(driver.tire.grip);
    driver.progress = progress;
    driver.laneOffset = 0;
    driver.lap = 1;

    const pose = sampleTrack(progress, 0);
    const remote = sampleTrack(0.65, 200);
    const physics = new RapierRacePhysics(
      createVehicle(remote.x, remote.y, remote.heading),
      [driver],
    );

    const pinned = {
      ...createVehicle(pose.x, pose.y, pose.heading),
      speed: 0,
    };

    try {
      // Simulate an obstruction that repeatedly prevents forward movement.
      // setAiState intentionally does not erase the recovery timer.
      for (let tick = 0; tick < 2 / DT; tick++) {
        physics.setAiState(0, pinned);
        physics.syncAiKinematics([driver], DT, -10);
        if (physics.aiRecoveryPhase(0) === 'REVERSE') break;
      }

      expect(physics.aiRecoveryPhase(0)).toBe('REVERSE');

      const before = physics.aiStates()[0];
      physics.step(DT);
      const after = physics.aiStates()[0];
      const forwardDisplacement =
        (after.x - before.x) * Math.cos(pose.heading)
        + (after.y - before.y) * Math.sin(pose.heading);

      expect(forwardDisplacement).toBeLessThan(0);
    } finally {
      physics.world.free();
    }
  });
});

function fastestStraight(grip: number): number {
  let progress = 0;
  let speed = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < 240; index++) {
    const sampleProgress = index / 240;
    const profile = trackProfile(sampleProgress, 1, grip);
    if (profile.targetSpeed > speed) {
      speed = profile.targetSpeed;
      progress = sampleProgress;
    }
  }
  return progress;
}
