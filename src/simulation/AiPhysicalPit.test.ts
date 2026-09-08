import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { PIT_ENTRY_PROGRESS } from './PitLaneModel';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField } from './RaceModel';
import { projectTrack, sampleTrack } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;

describe('physical AI pit stops', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('drives an AI car down pit lane, services it, and rejoins on the new compound', () => {
    const [driver] = createAiField();
    driver.lap = driver.pitLap;
    driver.progress = PIT_ENTRY_PROGRESS - 0.004;
    driver.speed = 88;

    const playerPose = sampleTrack(0.5);
    const physics = new RapierRacePhysics(
      createVehicle(playerPose.x, playerPose.y, playerPose.heading),
      [driver],
    );
    const aiPose = sampleTrack(driver.progress, driver.laneOffset);
    physics.setAiState(0, {
      ...createVehicle(aiPose.x, aiPose.y, aiPose.heading),
      speed: 88,
    });

    let enteredPit = false;
    let maximumPitOffset = 0;
    let completedStop = false;

    for (let tick = 0; tick < 28 / DT; tick++) {
      physics.syncAiKinematics([driver], DT, 1);
      physics.step(DT);

      enteredPit ||= physics.isAiPitting(0);
      const state = physics.aiStates()[0];
      maximumPitOffset = Math.max(maximumPitOffset, Math.abs(projectTrack(state.x, state.y).laneOffset));

      if (enteredPit && !physics.isAiPitting(0) && driver.usedCompounds.has(driver.nextCompound)) {
        completedStop = true;
        break;
      }
    }

    expect(enteredPit).toBe(true);
    expect(maximumPitOffset).toBeGreaterThan(55);
    expect(completedStop).toBe(true);
    expect(driver.tire.compound).toBe(driver.nextCompound);
    expect(driver.usedCompounds.has(driver.nextCompound)).toBe(true);
    expect(driver.strategyIntent).toBe('DONE');
  }, 20_000);
});
