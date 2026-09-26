import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField, type DriverState } from './RaceModel';
import { TRACK_BARRIER_OFFSET } from './TrackLimitsModel';
import { projectTrackNear, sampleTrack, TRACK_LENGTH } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;
const RUN_SECONDS = 8;

describe('CPU traffic line regression', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('keeps a clustered CPU pack out of the barrier contact envelope', () => {
    const seeds = createAiField().slice(0, 5).map((driver, index) => ({
      ...cloneDriver(driver),
      lap: 1,
      progress: 0.14 + (index * 6) / TRACK_LENGTH,
      laneOffset: 0,
      speed: 76 - index * 1.5,
    }));

    const cleanAirMax = Math.max(
      ...seeds.map((driver) => runPhysicalScenario([cloneDriver(driver)]).maxTrackDistance),
    );
    const clustered = runPhysicalScenario(seeds.map(cloneDriver));

    console.log(`AI_TRAFFIC_LINE_METRICS ${JSON.stringify({
      cleanAirMax: Number(cleanAirMax.toFixed(2)),
      clusteredMax: Number(clustered.maxTrackDistance.toFixed(2)),
      clusteredExtra: Number((clustered.maxTrackDistance - cleanAirMax).toFixed(2)),
      sawReverseRecovery: clustered.sawReverseRecovery,
    })}`);

    expect(clustered.sawReverseRecovery).toBe(false);
    // The original bug was the whole CPU group steering into the wall. Traffic
    // can change longitudinal phase enough to shift the maximum centreline
    // distance slightly, so the physical safety invariant is the useful gate:
    // the car centre must remain clear of the barrier/contact envelope.
    expect(clustered.maxTrackDistance).toBeLessThan(TRACK_BARRIER_OFFSET - 2.4);
  }, 20_000);
});

function runPhysicalScenario(ai: DriverState[]): {
  maxTrackDistance: number;
  sawReverseRecovery: boolean;
} {
  const remote = sampleTrack(0.72, 220);
  const physics = new RapierRacePhysics(
    createVehicle(remote.x, remote.y, remote.heading),
    ai,
  );

  ai.forEach((driver, index) => {
    const pose = sampleTrack(driver.progress, driver.laneOffset);
    physics.setAiState(index, {
      ...createVehicle(pose.x, pose.y, pose.heading),
      speed: driver.speed,
    });
  });

  let maxTrackDistance = 0;
  let sawReverseRecovery = false;

  try {
    for (let tick = 0; tick < RUN_SECONDS / DT; tick++) {
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

    return { maxTrackDistance, sawReverseRecovery };
  } finally {
    physics.world.free();
  }
}

function cloneDriver(driver: DriverState): DriverState {
  return {
    ...driver,
    tire: { ...driver.tire },
    usedCompounds: new Set(driver.usedCompounds),
    pitPlan: driver.pitPlan.map((stop) => ({ ...stop })),
  };
}
