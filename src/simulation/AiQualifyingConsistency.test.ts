import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { dynamicAiControl } from './DynamicAiController';
import { aiQualifyingTime } from './QualifyingModel';
import { referenceTarget } from './ReferenceDriverModel';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField } from './RaceModel';
import { compoundPeakGrip, createTire } from './TireModel';
import { projectTrackNear, sampleTrack, TRACK_LENGTH } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;
const DIAGNOSTIC_BINS = 10;
const FINE_BINS = 20;

interface LaneBin {
  ticks: number;
  speed: number;
  targetSpeed: number;
  laneError: number;
  signedLaneError: number;
  actualLane: number;
  referenceLane: number;
  controlLane: number;
  steer: number;
  maxLaneError: number;
}

function createBin(): LaneBin {
  return {
    ticks: 0,
    speed: 0,
    targetSpeed: 0,
    laneError: 0,
    signedLaneError: 0,
    actualLane: 0,
    referenceLane: 0,
    controlLane: 0,
    steer: 0,
    maxLaneError: 0,
  };
}

function addSample(
  bin: LaneBin,
  speed: number,
  targetSpeed: number,
  actualLane: number,
  referenceLane: number,
  controlLane: number,
  steer: number,
): void {
  const signedLaneError = actualLane - referenceLane;
  const laneError = Math.abs(signedLaneError);
  bin.ticks++;
  bin.speed += speed;
  bin.targetSpeed += targetSpeed;
  bin.laneError += laneError;
  bin.signedLaneError += signedLaneError;
  bin.actualLane += actualLane;
  bin.referenceLane += referenceLane;
  bin.controlLane += controlLane;
  bin.steer += steer;
  bin.maxLaneError = Math.max(bin.maxLaneError, laneError);
}

function summarizeBin(bin: LaneBin, index: number, count: number) {
  const samples = Math.max(1, bin.ticks);
  const step = 100 / count;
  return {
    p: `${index * step}-${(index + 1) * step}%`,
    seconds: Number((bin.ticks * DT).toFixed(2)),
    avgKmh: Math.round((bin.speed / samples) * 3.6),
    targetKmh: Math.round((bin.targetSpeed / samples) * 3.6),
    actualLane: Number((bin.actualLane / samples).toFixed(2)),
    referenceLane: Number((bin.referenceLane / samples).toFixed(2)),
    controlLane: Number((bin.controlLane / samples).toFixed(2)),
    avgSteer: Number((bin.steer / samples).toFixed(2)),
    signedLaneError: Number((bin.signedLaneError / samples).toFixed(2)),
    avgLaneError: Number((bin.laneError / samples).toFixed(2)),
    maxLaneError: Number(bin.maxLaneError.toFixed(2)),
  };
}

describe('physical AI qualifying consistency', () => {
  beforeAll(async () => {
    installReferenceLineCalibration();
    await RAPIER.init();
  });

  it('can execute the generated Pitwall reference with the same qualifying tyre state', () => {
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
    const bins = Array.from({ length: DIAGNOSTIC_BINS }, createBin);
    const fineBins = Array.from({ length: FINE_BINS }, createBin);
    const maximumSeconds = 70;

    for (let tick = 0; tick < maximumSeconds / DT; tick++) {
      physics.syncAiKinematics([driver], DT, -10);
      physics.step(DT);
      const elapsed = (tick + 1) * DT;

      if (driver.lap >= 1 && firstCrossing === undefined) firstCrossing = elapsed;

      if (firstCrossing !== undefined && driver.lap === 1) {
        const state = physics.aiStates()[0];
        const projection = projectTrackNear(state.x, state.y, driver.progress);
        const reference = referenceTarget('pitwall-gp', projection.progress, driver.tire.grip);
        const control = dynamicAiControl(driver, state, []);
        const coarseIndex = Math.min(DIAGNOSTIC_BINS - 1, Math.floor(projection.progress * DIAGNOSTIC_BINS));
        const fineIndex = Math.min(FINE_BINS - 1, Math.floor(projection.progress * FINE_BINS));
        addSample(
          bins[coarseIndex],
          state.speed,
          reference.targetSpeed,
          projection.laneOffset,
          reference.laneOffset,
          control.targetLane,
          control.steer,
        );
        addSample(
          fineBins[fineIndex],
          state.speed,
          reference.targetSpeed,
          projection.laneOffset,
          reference.laneOffset,
          control.targetLane,
          control.steer,
        );
      }

      if (driver.lap >= 2 && firstCrossing !== undefined) {
        flyingLap = elapsed - firstCrossing;
        break;
      }
    }

    expect(flyingLap).toBeDefined();
    const qualifying = aiQualifyingTime(driver, 'pitwall-gp', TRACK_LENGTH);
    const diagnosticBins = bins.map((bin, index) => summarizeBin(bin, index, DIAGNOSTIC_BINS));
    const fineDiagnosticBins = fineBins.map((bin, index) => summarizeBin(bin, index, FINE_BINS));
    console.log(`AI_QUALIFYING_CONSISTENCY ${JSON.stringify({
      qualifying: Number(qualifying.toFixed(3)),
      physicalFlyingLap: Number((flyingLap ?? 0).toFixed(3)),
      bins: diagnosticBins,
      fineBins: fineDiagnosticBins,
    })}`);

    expect(flyingLap!).toBeGreaterThan(qualifying - 0.8);
    expect(flyingLap!).toBeLessThan(qualifying + 1.8);
    expect(diagnosticBins[5].avgLaneError).toBeLessThan(5.5);
    expect(diagnosticBins[9].avgLaneError).toBeLessThan(5.5);
  }, 20_000);
});
