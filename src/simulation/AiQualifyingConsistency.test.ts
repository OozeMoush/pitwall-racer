import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { aiQualifyingTime } from './QualifyingModel';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField } from './RaceModel';
import { sampleTrack, TRACK_LENGTH } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;

describe('physical AI qualifying consistency', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('can reproduce its Pitwall GP qualifying pace on a clean physical lap', () => {
    const driver = createAiField()[0];
    const start = sampleTrack(driver.progress, driver.laneOffset);
    const remote = sampleTrack(0.5, 260);
    const physics = new RapierRacePhysics(createVehicle(remote.x, remote.y, remote.heading), [driver]);
    physics.setAiState(0, createVehicle(start.x, start.y, start.heading));

    let firstCrossing: number | undefined;
    let flyingLap: number | undefined;
    const maximumSeconds = 70;

    for (let tick = 0; tick < maximumSeconds / DT; tick++) {
      physics.syncAiKinematics([driver], DT, -10);
      physics.step(DT);
      const elapsed = (tick + 1) * DT;

      if (driver.lap >= 1 && firstCrossing === undefined) firstCrossing = elapsed;
      if (driver.lap >= 2 && firstCrossing !== undefined) {
        flyingLap = elapsed - firstCrossing;
        break;
      }
    }

    expect(flyingLap).toBeDefined();
    const qualifying = aiQualifyingTime(driver, 'pitwall-gp', TRACK_LENGTH);
    console.log(`AI_QUALIFYING_CONSISTENCY ${JSON.stringify({
      qualifying: Number(qualifying.toFixed(3)),
      physicalFlyingLap: Number((flyingLap ?? 0).toFixed(3)),
    })}`);

    // Race physics should tell the same story as the qualifying sheet. Allow a
    // small race-lap margin, but never an impossible five-to-ten-second promise.
    expect(flyingLap!).toBeGreaterThan(qualifying - 1.0);
    expect(flyingLap!).toBeLessThan(qualifying + 3.0);
  }, 20_000);
});
