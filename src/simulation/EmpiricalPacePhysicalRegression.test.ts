import RAPIER from '@dimforge/rapier2d-compat';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EmpiricalLapEvidence } from './PaceBenchmarkModel';
import { installPaceBenchmarkSession, resetPaceBenchmarkSession } from './PaceBenchmarkRuntime';
import { qualifyingPhysicsBenchmarkSeconds } from './QualifyingModel';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField } from './RaceModel';
import { DEEP_CUT_DISTANCE } from './TrackLimitsModel';
import { compoundPeakGrip, createTire } from './TireModel';
import { projectTrackNear, sampleTrack, setActiveTrack, TRACK_LENGTH } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;

function cleanEvidence(seconds: number): EmpiricalLapEvidence {
  return {
    trackId: 'pitwall-gp',
    seconds,
    compound: 'SOFT',
    startWear: 0.02,
    endWear: 0.08,
    deepCutRatio: 0,
    grassRatio: 0,
    maxTow: 0,
    launchAffected: false,
    recovered: false,
    pitted: false,
  };
}

describe('empirically calibrated physical AI', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  afterEach(() => {
    resetPaceBenchmarkSession();
    setActiveTrack('pitwall-gp');
  });

  it('turns a faster verified benchmark into physical pace without deep cutting', () => {
    setActiveTrack('pitwall-gp');
    const physicsReference = qualifyingPhysicsBenchmarkSeconds('pitwall-gp', TRACK_LENGTH);
    const benchmark = installPaceBenchmarkSession(
      'pitwall-gp',
      physicsReference,
      [cleanEvidence(24.342)],
    );

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
    let deepCuts = 0;
    let samples = 0;

    for (let tick = 0; tick < 70 / DT; tick++) {
      physics.syncAiKinematics([driver], DT, -10);
      physics.step(DT);
      const elapsed = (tick + 1) * DT;

      if (driver.lap >= 1 && firstCrossing === undefined) firstCrossing = elapsed;
      if (firstCrossing !== undefined && driver.lap === 1) {
        const state = physics.aiStates()[0];
        const projection = projectTrackNear(state.x, state.y, driver.progress);
        if (projection.distance > DEEP_CUT_DISTANCE) deepCuts += 1;
        samples += 1;
      }
      if (driver.lap >= 2 && firstCrossing !== undefined) {
        flyingLap = elapsed - firstCrossing;
        break;
      }
    }

    const deepCutRatio = deepCuts / Math.max(1, samples);
    console.log('EMPIRICAL_PACE_PHYSICAL', JSON.stringify({
      physicsReference: Number(physicsReference.toFixed(3)),
      benchmark: Number(benchmark.seconds.toFixed(3)),
      physicalFlyingLap: Number((flyingLap ?? 0).toFixed(3)),
      speedScale: Number((physicsReference / benchmark.seconds).toFixed(4)),
      deepCutRatio: Number(deepCutRatio.toFixed(4)),
    }));

    expect(flyingLap).toBeDefined();
    expect(flyingLap!).toBeGreaterThan(23.5);
    expect(flyingLap!).toBeLessThan(28.94);
    expect(deepCutRatio).toBeLessThan(0.025);
  }, 20_000);
});
