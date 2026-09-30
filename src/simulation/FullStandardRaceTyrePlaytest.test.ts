import RAPIER from '@dimforge/rapier2d-compat';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { raceLapsForPreset } from '../game/RaceSetup';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField, stepAiField, type DriverState } from './RaceModel';
import { DEEP_CUT_DISTANCE } from './TrackLimitsModel';
import {
  projectTrackNear,
  sampleTrack,
  setActiveTrack,
} from './TrackModel';
import type { Compound } from './TireModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 60;
const MAX_RACE_SECONDS = 35 * 60;

interface DriverTelemetry {
  name: string;
  maxWear: Record<Compound, number>;
  slideEvents: Array<{
    compound: Compound;
    wear: number;
    severity: number;
  }>;
  maxSlideSeverity: number;
  deepCutSamples: number;
  trackSamples: number;
}

beforeAll(async () => {
  await RAPIER.init();
});

afterEach(() => {
  setActiveTrack('pitwall-gp');
});

it('runs a full physical STANDARD race through H/M/S wear, slides, and real pit stops', () => {
  setActiveTrack('pitwall-gp');
  const totalLaps = raceLapsForPreset('pitwall-gp', 'STANDARD');
  expect(totalLaps).toBe(18);

  const source = createAiField(undefined, totalLaps);
  let field: DriverState[] = ['KITE', 'RIFT'].map((name, index) => {
    const driver = source.find((entry) => entry.name === name)!;
    const progress = index === 0 ? 0.02 : 0.52;
    return {
      ...driver,
      progress,
      lap: 1,
      speed: 72,
      laneOffset: 0,
      usedCompounds: new Set(driver.usedCompounds),
      pitPlan: driver.pitPlan.map((stop) => ({ ...stop })),
    };
  });

  const remote = sampleTrack(0.25, 260);
  const physics = new RapierRacePhysics(
    createVehicle(remote.x, remote.y, remote.heading),
    field,
  );

  field.forEach((driver, index) => {
    const pose = sampleTrack(driver.progress, driver.laneOffset);
    physics.setAiState(index, {
      ...createVehicle(pose.x, pose.y, pose.heading),
      speed: driver.speed,
    });
  });

  const telemetry: DriverTelemetry[] = field.map((driver) => ({
    name: driver.name,
    maxWear: { SOFT: 0, MEDIUM: 0, HARD: 0 },
    slideEvents: [],
    maxSlideSeverity: 0,
    deepCutSamples: 0,
    trackSamples: 0,
  }));
  const previousSlide = field.map(() => 0);

  let elapsed = 0;
  try {
    for (
      let tick = 0;
      tick < MAX_RACE_SECONDS / DT && !field.every((driver) => driver.finished);
      tick++
    ) {
      // RaceModel owns strategy and tyre evolution. Physical progress and pit
      // movement stay authoritative in Rapier, so do not advance kinematically.
      field = stepAiField(field, DT, totalLaps, [], false);

      field.forEach((driver, index) => {
        const row = telemetry[index];
        row.maxWear[driver.tire.compound] = Math.max(
          row.maxWear[driver.tire.compound],
          driver.tire.wear,
        );
      });

      physics.syncAiKinematics(field, DT, -10);
      physics.step(DT);
      elapsed += DT;

      field.forEach((driver, index) => {
        const severity = physics.aiSlideSeverity(index);
        const row = telemetry[index];
        row.maxSlideSeverity = Math.max(row.maxSlideSeverity, severity);
        if (severity > 0 && previousSlide[index] <= 0) {
          row.slideEvents.push({
            compound: driver.tire.compound,
            wear: driver.tire.wear,
            severity,
          });
        }
        previousSlide[index] = severity;
      });

      // Geometry checks are much more expensive than the physics step. 6 Hz is
      // plenty to detect a car spending meaningful race time beyond the kerb.
      if (tick % 10 === 0) {
        const states = physics.aiStates();
        states.forEach((state, index) => {
          // The dedicated pit lane is intentionally outside the main-road
          // track-limit envelope. Do not misclassify a legal physical pit stop
          // as a deep cut.
          if (physics.isAiPitting(index)) return;
          const driver = field[index];
          const projection = projectTrackNear(
            state.x,
            state.y,
            driver.progress,
          );
          telemetry[index].trackSamples += 1;
          if (projection.distance > DEEP_CUT_DISTANCE) {
            telemetry[index].deepCutSamples += 1;
          }
        });
      }
    }
  } finally {
    physics.world.free();
  }

  const metrics = telemetry.map((row, index) => ({
    name: row.name,
    finished: field[index].finished,
    lap: field[index].lap,
    pitStops: field[index].pitStopIndex,
    compounds: [...field[index].usedCompounds],
    maxWear: Object.fromEntries(
      Object.entries(row.maxWear).map(([compound, wear]) => [
        compound,
        Number(wear.toFixed(3)),
      ]),
    ),
    slideEvents: row.slideEvents.length,
    wornSlideEvents: row.slideEvents.filter((event) => event.wear >= 0.35).length,
    maxSlideSeverity: Number(row.maxSlideSeverity.toFixed(3)),
    deepCutRatio: Number(
      (row.deepCutSamples / Math.max(1, row.trackSamples)).toFixed(4),
    ),
  }));

  console.log(`FULL_STANDARD_TYRE_PLAYTEST ${JSON.stringify({
    totalLaps,
    elapsedSeconds: Number(elapsed.toFixed(1)),
    elapsedMinutes: Number((elapsed / 60).toFixed(2)),
    drivers: metrics,
  })}`);

  expect(elapsed).toBeGreaterThan(20 * 60);
  expect(elapsed).toBeLessThan(MAX_RACE_SECONDS);

  const kite = metrics.find((row) => row.name === 'KITE')!;
  const rift = metrics.find((row) => row.name === 'RIFT')!;
  expect(kite.finished).toBe(true);
  expect(rift.finished).toBe(true);
  expect(kite.pitStops).toBe(2);
  expect(rift.pitStops).toBe(2);
  expect(kite.compounds).toEqual(expect.arrayContaining(['HARD', 'MEDIUM']));
  expect(rift.compounds).toEqual(expect.arrayContaining(['HARD', 'SOFT']));

  // A useful stint should build substantial wear, but the scheduled stops
  // should prevent any legal live strategy from simply grinding to 100%.
  const combinedWear = {
    HARD: Math.max(...telemetry.map((row) => row.maxWear.HARD)),
    MEDIUM: Math.max(...telemetry.map((row) => row.maxWear.MEDIUM)),
    SOFT: Math.max(...telemetry.map((row) => row.maxWear.SOFT)),
  };
  expect(combinedWear.HARD).toBeGreaterThan(0.20);
  expect(combinedWear.MEDIUM).toBeGreaterThan(0.25);
  expect(combinedWear.SOFT).toBeGreaterThan(0.35);
  expect(Math.max(...Object.values(combinedWear))).toBeLessThan(0.95);

  // This is the missing physical validation: worn tyres must actually reach
  // the chassis slide system during a real STANDARD race, not only in the
  // isolated tyre model.
  const allSlides = telemetry.flatMap((row) => row.slideEvents);
  expect(allSlides.some((event) => event.wear >= 0.35)).toBe(true);
  expect(Math.max(...telemetry.map((row) => row.maxSlideSeverity))).toBeGreaterThan(0.7);

  for (const row of metrics) {
    expect(row.deepCutRatio, row.name).toBeLessThan(0.03);
  }
}, 180_000);
