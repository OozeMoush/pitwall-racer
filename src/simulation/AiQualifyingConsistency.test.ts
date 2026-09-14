import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { aiQualifyingTime } from './QualifyingModel';
import { referenceTarget } from './ReferenceDriverModel';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField } from './RaceModel';
import { compoundPeakGrip, createTire } from './TireModel';
import { projectTrackNear, sampleTrack, TRACK_LENGTH } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;
const DIAGNOSTIC_BINS = 10;

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
    const bins = Array.from({ length: DIAGNOSTIC_BINS }, () => ({
      ticks: 0,
      speed: 0,
      targetSpeed: 0,
      laneError: 0,
      maxLaneError: 0,
    }));
    const maximumSeconds = 70;

    for (let tick = 0; tick < maximumSeconds / DT; tick++) {
      physics.syncAiKinematics([driver], DT, -10);
      physics.step(DT);
      const elapsed = (tick + 1) * DT;

      if (driver.lap >= 1 && firstCrossing === undefined) firstCrossing = elapsed;

      if (firstCrossing !== undefined && driver.lap === 1) {
        const state = physics.aiStates()[0];
        const projection = projectTrackNear(state.x, state.y, driver.progress);
        const reference = referenceTarget('pitwall-gp', projection.progress, driver.tire.grip);
        const index = Math.min(DIAGNOSTIC_BINS - 1, Math.floor(projection.progress * DIAGNOSTIC_BINS));
        const laneError = Math.abs(projection.laneOffset - reference.laneOffset);
        const bin = bins[index];
        bin.ticks++;
        bin.speed += state.speed;
        bin.targetSpeed += reference.targetSpeed;
        bin.laneError += laneError;
        bin.maxLaneError = Math.max(bin.maxLaneError, laneError);
      }

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
      bins: bins.map((bin, index) => ({
        p: `${index * 10}-${(index + 1) * 10}%`,
        seconds: Number((bin.ticks * DT).toFixed(2)),
        avgKmh: Math.round((bin.speed / Math.max(1, bin.ticks)) * 3.6),
        targetKmh: Math.round((bin.targetSpeed / Math.max(1, bin.ticks)) * 3.6),
        avgLaneError: Number((bin.laneError / Math.max(1, bin.ticks)).toFixed(2)),
        maxLaneError: Number(bin.maxLaneError.toFixed(2)),
      })),
    })}`);

    // The benchmark is an intentionally perfect machine-limit reference. The
    // physical AI follows the same line/speed plan through a closed-loop
    // steering controller, so a small realization loss is legitimate; what we
    // reject is the old situation where qualifying pace and the real car told
    // completely different stories. Keep a little margin above the observed
    // controller realization loss rather than changing gameplay to chase a
    // single 120 Hz timing boundary.
    expect(flyingLap!).toBeGreaterThan(qualifying - 0.6);
    expect(flyingLap!).toBeLessThan(qualifying + 3.2);
  }, 20_000);
});
