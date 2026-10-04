import RAPIER from '@dimforge/rapier2d-compat';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { raceLapsForPreset } from '../game/RaceSetup';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField, stepAiField, type DriverState } from './RaceModel';
import { createTire, type Compound } from './TireModel';
import { DEEP_CUT_DISTANCE } from './TrackLimitsModel';
import { projectTrackNear, sampleTrack, setActiveTrack } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 60;
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { setActiveTrack('pitwall-gp'); });
const plans: Array<{ name: string; start: Compound; stops: Array<{ plannedLap: number; compound: Compound }> }> = [
  { name: 'M-H early one stop', start: 'MEDIUM', stops: [{ plannedLap: 16, compound: 'HARD' }] },
  { name: 'H-M late one stop', start: 'HARD', stops: [{ plannedLap: 32, compound: 'MEDIUM' }] },
  { name: 'H-M-H two stops', start: 'HARD', stops: [{ plannedLap: 19, compound: 'MEDIUM' }, { plannedLap: 32, compound: 'HARD' }] },
  { name: 'H-S-H attacking two stops', start: 'HARD', stops: [{ plannedLap: 19, compound: 'SOFT' }, { plannedLap: 29, compound: 'HARD' }] },
];

it.each(plans)('measures the isolated physical STANDARD race: $name', ({ name, start, stops }) => {
  setActiveTrack('pitwall-gp');
  const totalLaps = raceLapsForPreset('pitwall-gp', 'STANDARD');
  const base = createAiField(undefined, totalLaps)[0];
  let field: DriverState[] = [{ ...base, id: 'ai-0', name: 'CONTROL', skill: 1.127,
    progress: 0.02, lap: 1, speed: 72, laneOffset: 0,
    tire: createTire(start), usedCompounds: new Set<Compound>([start]),
    pitPlan: stops, plannedPitLap: stops[0].plannedLap, pitLap: stops[0].plannedLap,
    nextCompound: stops[0].compound, pitStopIndex: 0 }];
  const remote = sampleTrack(0.25, 260);
  const physics = new RapierRacePhysics(createVehicle(remote.x, remote.y, remote.heading), field);
  const pose = sampleTrack(0.02);
  physics.setAiState(0, { ...createVehicle(pose.x, pose.y, pose.heading), speed: 72 });
  let elapsed = 0;
  let samples = 0;
  let cuts = 0;
  try {
    for (let tick = 0; tick < 40 * 60 / DT && !field[0].finished; tick++) {
      field = stepAiField(field, DT, totalLaps, [], false);
      physics.syncAiKinematics(field, DT, -10);
      physics.step(DT);
      elapsed += DT;
      if (tick % 10 === 0 && !physics.isAiPitting(0)) {
        const state = physics.aiStates()[0];
        const projection = projectTrackNear(state.x, state.y, field[0].progress);
        samples++;
        if (projection.distance > DEEP_CUT_DISTANCE) cuts++;
      }
    }
  } finally { physics.world.free(); }
  const driver = field[0];
  console.info(`COMPACT_PHYSICAL_STRATEGY ${JSON.stringify({ name, elapsed,
    pitStops: driver.pitStopIndex, usedCompounds: [...driver.usedCompounds],
    finishWear: driver.tire.wear, deepCutRatio: cuts / samples })}`);
  expect(driver.finished).toBe(true);
  expect(driver.pitStopIndex).toBe(stops.length);
  expect(driver.usedCompounds.size).toBeGreaterThanOrEqual(2);
  expect(cuts / samples).toBeLessThan(0.03);
}, 240_000);
