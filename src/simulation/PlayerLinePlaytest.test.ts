import RAPIER from '@dimforge/rapier2d-compat';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { AiReferenceGhost } from './AiReferenceGhost';
import { PlayerRacingLineCandidateRecorder } from './PlayerRacingLineCandidate';
import { createAiField, stepAiField } from './RaceModel';
import { RapierRacePhysics } from './RapierRacePhysics';
import { setRuntimeRacingLine, sampleRuntimeRacingLinePose } from './RacingLineRuntime';
import { TRACK_LIMIT_HALF_WIDTH } from './LapValidityModel';
import { createTire, type Compound } from './TireModel';
import { projectTrackNear, setActiveTrack } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { setRuntimeRacingLine('pitwall-gp', undefined); });

it('executes a demonstrated PLAYER line for multiple laps on every race compound', () => {
  setActiveTrack('pitwall-gp');
  setRuntimeRacingLine('pitwall-gp', undefined);
  const source = new AiReferenceGhost(0, 'pitwall-gp');
  for (let tick = 0; tick < 100 / DT && source.warmupLapsRemaining() > 0; tick++) source.step(DT);
  const recorder = new PlayerRacingLineCandidateRecorder();
  recorder.begin('pitwall-gp', source.driver.tire.grip);
  let time = 0;
  for (let tick = 0; tick < 45 / DT; tick++) {
    source.step(DT);
    time += DT;
    const state = source.state()!;
    const p = projectTrackNear(state.x, state.y, source.driver.progress);
    recorder.sample(p.progress, p.laneOffset, state.speed,
      Math.atan2(Math.sin(state.heading - p.heading), Math.cos(state.heading - p.heading)),
      state.yawRate, DT, source.driver.tire.grip, source.latestForwardAcceleration());
    if (source.lastLapSeconds()) break;
  }
  const asset = recorder.finish(time)!;
  expect(asset).toBeDefined();
  source.physics.world.free();
  setRuntimeRacingLine('pitwall-gp', asset);
  const results = [];
  for (const compound of ['GHOST', 'SOFT', 'MEDIUM', 'HARD'] as const) {
    const ghost = compound === 'GHOST' ? new AiReferenceGhost(0, 'pitwall-gp', true) : undefined;
    const driver = ghost?.driver ?? { ...createAiField()[1], progress: 0, lap: 1,
      tire: createTire(compound as Compound), pitLap: 999, plannedPitLap: 999 };
    const physics = ghost?.physics ?? new RapierRacePhysics(createVehicle(-10000, -10000, 0), [driver]);
    if (!ghost) {
      const pose = sampleRuntimeRacingLinePose('pitwall-gp', 0);
      physics.setAiState(0, { ...createVehicle(pose.x, pose.y, pose.heading),
        speed: pose.targetSpeed, yawRate: asset.points[0].yawRate ?? 0 }, pose.trajectoryHeading);
    }
    const laps: number[] = [];
    const sections = Array.from({ length: 10 }, () => ({ seconds: 0, speed: 0, target: 0, path: 0, brake: 0, feedback: 0, throttle: 0, samples: 0 }));
    let worst: unknown;
    let previous = 0, lapTime = 0, stall = 0, maxStall = 0, departure = 0, maxDeparture = 0, maxPath = 0;
    for (let tick = 0; tick < 130 / DT && laps.length < 3; tick++) {
      if (ghost) ghost.step(DT);
      else { physics.syncAiKinematics([driver], DT, -10); physics.step(DT); }
      const state = physics.aiStates()[0];
      const control = ghost?.latestControl() ?? physics.aiControls()[0]!;
      lapTime += DT;
      stall = state.speed * 3.6 < 15 && control.targetSpeed > 20 ? stall + DT : 0;
      maxStall = Math.max(maxStall, stall);
      departure = control.debug.pathError > 15 ? departure + DT : 0;
      maxDeparture = Math.max(maxDeparture, departure);
      if (control.debug.pathError > maxPath) worst = {progress: driver.progress, speed: state.speed, control};
      maxPath = Math.max(maxPath, control.debug.pathError);
      const section = sections[Math.min(9, Math.floor(driver.progress * 10))];
      section.seconds += DT; section.speed += state.speed; section.target += control.targetSpeed;
      section.path += control.debug.pathError; section.brake += control.debug.profileBrake;
      section.feedback += control.debug.feedbackBrake; section.throttle += control.throttle; section.samples++;
      if (previous > 0.9 && driver.progress < 0.1) { laps.push(lapTime); lapTime = 0; }
      previous = driver.progress;
    }
    const round = (n: number) => Number(n.toFixed(3));
    results.push({ compound, worst, laps: laps.map(round), maxStall: round(maxStall), maxDeparture: round(maxDeparture), maxPath: round(maxPath),
      sections: sections.map(s => ({ seconds: round(s.seconds / Math.max(1, laps.length)),
        speed: round(s.speed / s.samples), target: round(s.target / s.samples), path: round(s.path / s.samples),
        brake: round(s.brake / s.samples), feedback: round(s.feedback / s.samples), throttle: round(s.throttle / s.samples) })) });
    physics.world.free();
  }
  console.info('PLAYER_LINE_PLAYTEST', JSON.stringify({ sourceSeconds: time, results }));
  for (const result of results) {
    expect(result.laps.length, result.compound).toBe(3);
    expect(result.maxStall, result.compound).toBeLessThan(3);
    expect(result.maxDeparture, result.compound).toBeLessThan(3);
    // Clear-air error stays within one visible car width, including the seam.
    expect(result.maxPath, result.compound).toBeLessThan(2 * TRACK_LIMIT_HALF_WIDTH);
    expect(Math.max(...result.laps.slice(1)) - Math.min(...result.laps.slice(1))).toBeLessThan(0.25);
  }
  const ghost = results[0], soft = results[1];
  expect(Math.min(...ghost.laps.slice(1))).toBeLessThan(time * 1.05);
  expect(Math.min(...soft.laps.slice(1))).toBeLessThan(Math.min(...ghost.laps.slice(1)));
  expect(Math.min(...soft.laps.slice(1))).toBeLessThan(Math.min(...results[2].laps.slice(1)));
  expect(Math.min(...results[2].laps.slice(1))).toBeLessThan(Math.min(...results[3].laps.slice(1)));

  const brakePoint = asset.points.reduce((a, b) => (b.forwardAcceleration ?? 0) < (a.forwardAcceleration ?? 0) ? b : a);
  const stopped = { ...createAiField()[0], progress: brakePoint.progress, lap: 1, pitLap: 999 };
  const recovery = new RapierRacePhysics(createVehicle(-10000, -10000, 0), [stopped]);
  const stopPose = sampleRuntimeRacingLinePose('pitwall-gp', brakePoint.progress);
  recovery.setAiState(0, createVehicle(stopPose.x, stopPose.y, stopPose.heading));
  let recoveryStall = 0, maxRecoveryStall = 0;
  try {
    for (let tick = 0; tick < 5 / DT; tick++) {
      recovery.syncAiKinematics([stopped], DT, -10);
      if (tick === 0) {
        expect(recovery.aiControls()[0]!.debug.profileBrake).toBeGreaterThan(0.1);
        expect(recovery.aiControls()[0]!.brake).toBe(0);
      }
      recovery.step(DT);
      recoveryStall = recovery.aiStates()[0].speed * 3.6 < 15 ? recoveryStall + DT : 0;
      maxRecoveryStall = Math.max(maxRecoveryStall, recoveryStall);
    }
    console.info('PLAYER_LINE_RECOVERY', JSON.stringify({ maxStall: maxRecoveryStall, finalKmh: recovery.aiStates()[0].speed * 3.6 }));
    expect(maxRecoveryStall).toBeLessThan(3);
    expect(recovery.aiStates()[0].speed * 3.6).toBeGreaterThan(15);
  } finally { recovery.world.free(); }

  let pack = createAiField().map(d => ({ ...d, pitLap: 999, plannedPitLap: 999 }));
  const physics = new RapierRacePhysics(createVehicle(-10000, -10000, 0), pack);
  const telemetry = pack.map(d => ({ name: d.name, laps: 0, stall: 0, maxStall: 0, departure: 0, maxDeparture: 0, maxPath: 0 }));
  try {
    // The regression only needs every CPU identity to survive multiple laps on
    // the PLAYER line. The old fixed 120-second window kept simulating long
    // after all seven cars had already satisfied the Lap 3 assertion.
    const packTimeoutTicks = 90 / DT;
    for (let tick = 0; tick < packTimeoutTicks; tick++) {
      pack = stepAiField(pack, DT, 20, [], false);
      physics.syncAiKinematics(pack, DT, -10);
      physics.step(DT);
      const states = physics.aiStates();
      physics.aiControls().forEach((control, index) => {
        if (!control) return;
        const row = telemetry[index];
        row.laps = pack[index].lap;
        row.stall = states[index].speed * 3.6 < 15 && control.targetSpeed > 20 ? row.stall + DT : 0;
        row.maxStall = Math.max(row.maxStall, row.stall);
        row.departure = control.battleState === 'CLEAR' && control.debug.pathError > 15 ? row.departure + DT : 0;
        row.maxDeparture = Math.max(row.maxDeparture, row.departure);
        row.maxPath = Math.max(row.maxPath, control.debug.pathError);
      });
      if (telemetry.every((row) => row.laps >= 3)) break;
    }
    console.info('PLAYER_LINE_PACK', JSON.stringify(telemetry));
    for (const row of telemetry) {
      expect(row.laps, row.name).toBeGreaterThanOrEqual(3);
      expect(row.maxStall, row.name).toBeLessThan(3);
      expect(row.maxDeparture, row.name).toBeLessThan(3);
    }
  } finally { physics.world.free(); }

}, 120_000);
