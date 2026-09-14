import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { aiQualifyingTime } from './QualifyingModel';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField } from './RaceModel';
import { compoundPeakGrip, createTire } from './TireModel';
import { sampleTrack, TRACK_LENGTH } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;

describe('physical AI qualifying consistency', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('can execute the generated Pitwall reference with the same qualifying tyre state', () => {
    const driver = createAiField()[0];
    driver.tire = {
      ...createTire('SOFT'),
      grip: compoundPeakGrip('SOFT', 'PUSH'),
      temperature: 103,
      wear: 0,
    };
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

    // The benchmark is an intentionally perfect machine-limit reference. The
    // physical AI follows the same line/speed plan through a closed-loop
    // steering controller, so a small realization loss is legitimate; what we
    // reject is the old situation where qualifying pace and the real car told
    // completely different stories.
    expect(flyingLap!).toBeGreaterThan(qualifying - 0.6);
    expect(flyingLap!).toBeLessThan(qualifying + 3.0);
  }, 20_000);
});
