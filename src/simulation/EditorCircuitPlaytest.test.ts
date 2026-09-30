import RAPIER from '@dimforge/rapier2d-compat';
import { afterEach, beforeAll, expect, it } from 'vitest';
import {
  circuitReferenceLineAsset,
  createDefaultCircuitAsset,
  exportCircuitAsset,
  importCircuitAsset,
  installCircuitAsset,
} from './CircuitAsset';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField } from './RaceModel';
import { setRuntimeRacingLine } from './RacingLineRuntime';
import { trackRunoffHalfWidth } from './TrackLimitsModel';
import {
  EDITOR_TRACK_ID,
  getActiveTrack,
  projectTrack,
  sampleTrack,
  setActiveTrack,
  TRACK_LENGTH,
} from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;
const TEST_SECONDS = 14;

beforeAll(async () => {
  await RAPIER.init();
});

afterEach(() => {
  setRuntimeRacingLine(EDITOR_TRACK_ID, undefined);
  setActiveTrack('pitwall-gp');
});

it('runs an exported editor-authored Foundry Loop through the normal physical AI runtime', () => {
  const authored = createDefaultCircuitAsset();
  // Use a conservative authored seed for the end-to-end gate. Separate tests
  // verify non-zero editable offsets; this test asks whether a user-created
  // circuit can be exported, imported and physically driven without bespoke
  // source geometry.
  authored.referenceLine.laneOffsets = authored.referenceLine.laneOffsets.map(() => 0);
  authored.controls[3].roadHalfWidth = 13;
  authored.controls[4].roadHalfWidth = 13;

  const imported = importCircuitAsset(exportCircuitAsset(authored));
  installCircuitAsset(imported);
  setActiveTrack(EDITOR_TRACK_ID);
  setRuntimeRacingLine(EDITOR_TRACK_ID, circuitReferenceLineAsset(imported));

  expect(getActiveTrack().name).toBe('FOUNDRY LOOP');
  expect(getActiveTrack().editorAuthored).toBe(true);
  expect(TRACK_LENGTH).toBeGreaterThan(1800);

  const driver = {
    ...createAiField(undefined, 12)[0],
    pitLap: 999,
    plannedPitLap: 999,
  };
  const remote = sampleTrack(0.5, 260);
  const physics = new RapierRacePhysics(
    createVehicle(remote.x, remote.y, remote.heading),
    [driver],
  );

  let samples = 0;
  let grassSamples = 0;
  let speedSum = 0;
  let maxPathError = 0;
  try {
    for (let tick = 0; tick < TEST_SECONDS / DT; tick++) {
      physics.syncAiKinematics([driver], DT, -10);
      physics.step(DT);

      const state = physics.aiStates()[0];
      const control = physics.aiControls()[0];
      const projection = projectTrack(state.x, state.y);
      if (projection.distance >= trackRunoffHalfWidth(projection.progress)) {
        grassSamples += 1;
      }
      speedSum += state.speed;
      maxPathError = Math.max(maxPathError, control?.debug.pathError ?? 0);
      samples += 1;
    }

    const averageKmh = speedSum / Math.max(1, samples) * 3.6;
    const grassRatio = grassSamples / Math.max(1, samples);
    const control = physics.aiControls()[0];

    console.info('EDITOR_CIRCUIT_PLAYTEST', JSON.stringify({
      track: getActiveTrack().id,
      length: Math.round(TRACK_LENGTH),
      averageKmh: Math.round(averageKmh),
      grassRatio: Number(grassRatio.toFixed(4)),
      maxPathError: Number(maxPathError.toFixed(2)),
      lineSource: control?.debug.lineSource,
    }));

    expect(control?.debug.lineSource).toBe('EDITOR');
    expect(averageKmh).toBeGreaterThan(80);
    expect(grassRatio).toBeLessThan(0.08);
    expect(maxPathError).toBeLessThan(18);
  } finally {
    physics.world.free();
  }
}, 20_000);
