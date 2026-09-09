import RAPIER from '@dimforge/rapier2d-compat';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField } from './RaceModel';
import { projectTrack, sampleTrack, setActiveTrack, TRACKS } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;
const TEST_SECONDS = 12;

describe('selectable circuit physical playtest', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  afterAll(() => setActiveTrack('pitwall-gp'));

  for (const definition of TRACKS) {
    it(`${definition.name} keeps the physical AI racing on the circuit`, () => {
      setActiveTrack(definition.id);
      const ai = createAiField();
      // Keep the unused player body well away from the pack and many logical
      // laps behind so it cannot affect traffic decisions in this AI-only gate.
      const remote = sampleTrack(0.5, 260);
      const physics = new RapierRacePhysics(createVehicle(remote.x, remote.y, remote.heading), ai);

      let offTrack = 0;
      let samples = 0;
      let speedSum = 0;
      let maxSpeed = 0;

      for (let tick = 0; tick < TEST_SECONDS / DT; tick++) {
        physics.syncAiKinematics(ai, DT, -10);
        physics.step(DT);
        for (const state of physics.aiStates()) {
          const projection = projectTrack(state.x, state.y);
          if (projection.distance > 42) offTrack += 1;
          speedSum += state.speed;
          maxSpeed = Math.max(maxSpeed, state.speed);
          samples += 1;
        }
      }

      const offTrackRatio = offTrack / Math.max(1, samples);
      const avgKmh = (speedSum / Math.max(1, samples)) * 3.6;
      const maxKmh = maxSpeed * 3.6;
      console.log(`CIRCUIT_PLAYTEST ${JSON.stringify({ track: definition.id, avgKmh: Math.round(avgKmh), maxKmh: Math.round(maxKmh), offTrackRatio: Number(offTrackRatio.toFixed(4)) })}`);

      expect(avgKmh).toBeGreaterThan(150);
      expect(maxKmh).toBeGreaterThan(250);
      expect(offTrackRatio).toBeLessThan(0.035);
    }, 15_000);
  }
});
