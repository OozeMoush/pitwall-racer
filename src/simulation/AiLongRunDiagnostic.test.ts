import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField } from './RaceModel';
import { projectTrackNear, sampleTrack } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;

describe('isolated AI long-run diagnostic', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('keeps making forward race progress beyond the first technical complex', () => {
    const driver = createAiField()[0];
    const start = sampleTrack(driver.progress, driver.laneOffset);
    const remote = sampleTrack(0.5, 260);
    const physics = new RapierRacePhysics(createVehicle(remote.x, remote.y, remote.heading), [driver]);
    physics.setAiState(0, createVehicle(start.x, start.y, start.heading));

    const checkpoints: Array<Record<string, number>> = [];
    for (let tick = 0; tick < 30 / DT; tick++) {
      physics.syncAiKinematics([driver], DT, -10);
      physics.step(DT);
      if ((tick + 1) % (5 / DT) === 0) {
        const state = physics.aiStates()[0];
        const projection = projectTrackNear(state.x, state.y, driver.progress);
        checkpoints.push({
          seconds: (tick + 1) * DT,
          lap: driver.lap,
          progress: Number(driver.progress.toFixed(4)),
          lane: Number(projection.laneOffset.toFixed(2)),
          distance: Number(projection.distance.toFixed(2)),
          speedKmh: Number((state.speed * 3.6).toFixed(1)),
          x: Number(state.x.toFixed(1)),
          y: Number(state.y.toFixed(1)),
        });
      }
    }

    console.log(`AI_LONG_RUN ${JSON.stringify(checkpoints)}`);
    expect(checkpoints).toHaveLength(6);
  }, 15_000);
});
