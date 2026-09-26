import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField } from './RaceModel';
import { TRACK_KERB_OUTER_OFFSET } from './TrackLimitsModel';
import { projectTrackNear, sampleTrack, TRACK_LENGTH } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;

describe('CPU traffic line regression', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('keeps a clustered CPU pack on the reference route instead of steering into walls', () => {
    const ai = createAiField().slice(0, 5);
    const baseProgress = 0.14;
    const remote = sampleTrack(0.72, 220);
    const physics = new RapierRacePhysics(
      createVehicle(remote.x, remote.y, remote.heading),
      ai,
    );

    ai.forEach((driver, index) => {
      driver.lap = 1;
      driver.progress = baseProgress + (index * 6) / TRACK_LENGTH;
      driver.laneOffset = 0;
      driver.speed = 76 - index * 1.5;
      const pose = sampleTrack(driver.progress, 0);
      physics.setAiState(index, {
        ...createVehicle(pose.x, pose.y, pose.heading),
        speed: driver.speed,
      });
    });

    let maxTrackDistance = 0;
    let sawReverseRecovery = false;

    try {
      for (let tick = 0; tick < 8 / DT; tick++) {
        physics.syncAiKinematics(ai, DT, -10);
        ai.forEach((_, index) => {
          if (physics.aiRecoveryPhase(index) === 'REVERSE') {
            sawReverseRecovery = true;
          }
        });
        physics.step(DT);

        const states = physics.aiStates();
        states.forEach((state, index) => {
          const projection = projectTrackNear(
            state.x,
            state.y,
            ai[index].progress,
          );
          maxTrackDistance = Math.max(maxTrackDistance, projection.distance);
        });
      }

      expect(sawReverseRecovery).toBe(false);
      expect(maxTrackDistance).toBeLessThan(TRACK_KERB_OUTER_OFFSET + 1.5);
      expect(ai.every((driver) => driver.progress !== baseProgress)).toBe(true);
    } finally {
      physics.world.free();
    }
  }, 15_000);
});
