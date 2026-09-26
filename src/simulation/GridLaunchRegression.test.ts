import RAPIER from '@dimforge/rapier2d-compat';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField, raceDistance } from './RaceModel';
import { TRACK_RUNOFF_HALF_WIDTH } from './TrackLimitsModel';
import {
  projectTrack,
  sampleTrack,
  setActiveTrack,
  TRACK_LENGTH,
} from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;
const LAUNCH_SECONDS = 3;

beforeAll(async () => {
  await RAPIER.init();
});

afterAll(() => {
  setActiveTrack('pitwall-gp');
});

describe('compact physical grid launch', () => {
  for (const p2Id of ['ai-1', 'ai-4']) {
    it(`lets ${p2Id} launch cleanly from P2 instead of sticking in the wall`, () => {
      setActiveTrack('pitwall-gp');

      const aiIds = Array.from({ length: 7 }, (_, index) => `ai-${index}`);
      const others = aiIds.filter((id) => id !== p2Id);
      const gridOrder = [others[0], p2Id, ...others.slice(1), 'player'];
      const field = createAiField(gridOrder);
      const p2 = field.find((driver) => driver.id === p2Id);
      expect(p2).toBeDefined();
      expect(gridOrder.indexOf(p2Id)).toBe(1);

      // AI cars intentionally do not collide with one another. The original
      // P2 regression was a slot-versus-wall problem, so a one-car physics
      // world exercises the same barrier/controller path without spending most
      // of the test budget simulating six irrelevant opponents.
      const ai = [p2!];
      const remotePlayer = sampleTrack(0.5, 260);
      const physics = new RapierRacePhysics(
        createVehicle(remotePlayer.x, remotePlayer.y, remotePlayer.heading),
        ai,
      );
      const startDistance =
        raceDistance(p2!.lap, p2!.progress) * TRACK_LENGTH;

      try {
        for (let tick = 0; tick < LAUNCH_SECONDS / DT; tick++) {
          physics.syncAiKinematics(ai, DT, -10);
          physics.step(DT);
        }

        const state = physics.aiStates()[0];
        const projection = projectTrack(state.x, state.y);
        const endDistance =
          raceDistance(p2!.lap, p2!.progress) * TRACK_LENGTH;

        expect(endDistance - startDistance).toBeGreaterThan(25);
        expect(state.speed).toBeGreaterThan(15);
        expect(projection.distance).toBeLessThan(TRACK_RUNOFF_HALF_WIDTH);
      } finally {
        physics.world.free();
      }
    });
  }
});
