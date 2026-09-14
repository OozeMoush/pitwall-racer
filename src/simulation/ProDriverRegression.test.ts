import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField, raceDistance } from './RaceModel';
import { DEEP_CUT_DISTANCE } from './TrackLimitsModel';
import { projectTrackNear, sampleTrack } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;

describe('professional AI driving regression', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('keeps a clear-lap driver fast and on the circuit instead of discovering the wall', () => {
    const driver = createAiField()[0];
    driver.progress = 0.02;
    driver.lap = 1;
    driver.laneOffset = 0;
    driver.preferredLane = 0;
    const startDistance = raceDistance(driver.lap, driver.progress);
    const start = sampleTrack(driver.progress, 0);
    const physics = new RapierRacePhysics(createVehicle(0, 0, 0), [driver]);
    physics.setAiState(0, { ...createVehicle(start.x, start.y, start.heading), speed: 72 });

    let deepCuts = 0;
    let samples = 0;
    for (let tick = 0; tick < 28 / DT; tick++) {
      physics.syncAiKinematics([driver], DT, -10);
      physics.step(DT);
      const state = physics.aiStates()[0];
      const projection = projectTrackNear(state.x, state.y, driver.progress);
      if (projection.distance > DEEP_CUT_DISTANCE) deepCuts += 1;
      samples += 1;
    }

    // A quick car can now cross the start line inside this window, so compare
    // total race distance rather than raw progress modulo one lap.
    expect(raceDistance(driver.lap, driver.progress) - startDistance).toBeGreaterThan(0.80);
    expect(deepCuts / samples).toBeLessThan(0.025);
  }, 20_000);
});
