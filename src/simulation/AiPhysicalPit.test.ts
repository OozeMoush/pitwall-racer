import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { PIT_ENTRY_PROGRESS, pitStopDurationSeconds } from './PitLaneModel';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField } from './RaceModel';
import { TRACK_ROAD_HALF_WIDTH } from './TrackLimitsModel';
import { projectTrack, sampleTrack } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;

describe('physical AI pit stops', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('drives an AI car down pit lane, services it, and rejoins on the same shared timing model', () => {
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
    let pitTicks = 0;
    let maximumPitOffset = 0;
    let completedStop = false;

    for (let tick = 0; tick < 32 / DT; tick++) {
      physics.syncAiKinematics([driver], DT, 1);
      physics.step(DT);

      const pittingNow = physics.isAiPitting(0);
      if (pittingNow) {
        enteredPit = true;
        pitTicks += 1;
      }
      const state = physics.aiStates()[0];
      maximumPitOffset = Math.max(maximumPitOffset, Math.abs(projectTrack(state.x, state.y).laneOffset));

      if (enteredPit && !pittingNow && driver.usedCompounds.has(driver.nextCompound)) {
        completedStop = true;
        break;
      }
    }

    const measuredPitSeconds = pitTicks * DT;
    expect(enteredPit).toBe(true);
    expect(maximumPitOffset).toBeGreaterThan(TRACK_ROAD_HALF_WIDTH * 2);
    expect(completedStop).toBe(true);
    expect(Math.abs(measuredPitSeconds - pitStopDurationSeconds())).toBeLessThan(0.12);
    expect(driver.tire.compound).toBe(driver.nextCompound);
    expect(driver.usedCompounds.has(driver.nextCompound)).toBe(true);
    expect(driver.strategyIntent).toBe('DONE');
  }, 20_000);
});
