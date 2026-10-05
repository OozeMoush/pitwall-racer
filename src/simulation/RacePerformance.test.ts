import RAPIER from '@dimforge/rapier2d-compat';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { createAiField } from './RaceModel';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createVehicle } from './VehicleModel';
import { setRuntimeRacingLine } from './RacingLineRuntime';
import { sampleTrack, setActiveTrack, TRACKS } from './TrackModel';

beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { setRuntimeRacingLine('pitwall-gp', undefined); setActiveTrack('pitwall-gp'); });
it('reports CPU field physics costs separately from rendering', () => {
  const track = TRACKS[0];
  for (const source of ['AUTO', 'PLAYER', 'PLAYER_DYNAMICS'] as const) {
    setActiveTrack(track.id);
    setRuntimeRacingLine(track.id, source === 'AUTO' ? undefined : {
      version: 1, trackId: track.id, source: 'PLAYER', referenceGrip: 1.76,
      points: Array.from({ length: 640 }, (_, index) => {
        const progress = index / 640;
        const pose = sampleTrack(progress);
        return { progress, laneOffset: 0, targetSpeed: 72, worldX: pose.x, worldY: pose.y,
          bodyHeading: pose.heading, headingOffset: source === 'PLAYER_DYNAMICS' ? 0 : undefined, yawRate: 0, tireGrip: 1.76, forwardAcceleration: 0 };
      }),
    });
    for (const count of [0, 7]) {
      const drivers = createAiField(undefined, 48).slice(0, count);
      const pose = sampleTrack(0.5, 260);
      const physics = new RapierRacePhysics(createVehicle(pose.x, pose.y, pose.heading), drivers);
      let controllerMs = 0, physicsMs = 0;
      try {
        for (let tick = 0; tick < 360; tick++) {
          let start = performance.now();
          physics.syncAiKinematics(drivers, 1 / 120, -10);
          const control = performance.now() - start;
          start = performance.now();
          physics.step(1 / 120);
          if (tick >= 120) { controllerMs += control; physicsMs += performance.now() - start; }
        }
        expect(controllerMs / 240).toBeLessThan(50);
        console.info('RACE_CPU_COST', JSON.stringify({ track: track.id, source, count,
          controllerMsPerTick: controllerMs / 240, physicsMsPerTick: physicsMs / 240 }));
      } finally { physics.world.free(); }
    }
  }
}, 60_000);
