import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField, raceDistance } from './RaceModel';
import { DEEP_CUT_DISTANCE } from './TrackLimitsModel';
import { projectTrackNear, sampleTrack, TRACK_LENGTH } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;

describe('professional AI driving regression', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('keeps a clear-lap driver fast, on-circuit, and free of nervous weaving', () => {
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
    const laneSamples: number[] = [];
    const sampleEvery = Math.round(0.20 / DT);
    for (let tick = 0; tick < 28 / DT; tick++) {
      physics.syncAiKinematics([driver], DT, -10);
      physics.step(DT);
      const state = physics.aiStates()[0];
      const projection = projectTrackNear(state.x, state.y, driver.progress);
      if (projection.distance > DEEP_CUT_DISTANCE) deepCuts += 1;
      if (tick % sampleEvery === 0) laneSamples.push(projection.laneOffset);
      samples += 1;
    }

    let largeReversals = 0;
    let previousDelta = 0;
    for (let index = 1; index < laneSamples.length; index++) {
      const delta = laneSamples[index] - laneSamples[index - 1];
      if (Math.abs(delta) > 0.8
        && Math.abs(previousDelta) > 0.8
        && Math.sign(delta) !== Math.sign(previousDelta)) {
        largeReversals += 1;
      }
      if (Math.abs(delta) > 0.35) previousDelta = delta;
    }

    console.log('PRO_DRIVER_LINE', JSON.stringify({
      largeReversals,
      laneRange: Number((Math.max(...laneSamples) - Math.min(...laneSamples)).toFixed(2)),
      deepCutRatio: Number((deepCuts / samples).toFixed(4)),
    }));

    // A quick car can now cross the start line inside this window, so compare
    // total race distance rather than raw progress modulo one lap.
    const travelledMetres = (raceDistance(driver.lap, driver.progress) - startDistance) * TRACK_LENGTH;
    expect(travelledMetres).toBeGreaterThan(2500);
    expect(deepCuts / samples).toBeLessThan(0.025);
    // The racing line legitimately crosses the circuit between corners, but it
    // should not reverse direction every few tenths like a driver sawing at the
    // wheel. Keep a generous cap for real corner-to-corner transitions.
    expect(largeReversals).toBeLessThan(24);
  }, 20_000);
});
