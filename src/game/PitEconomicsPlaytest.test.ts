import RAPIER from '@dimforge/rapier2d-compat';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { AiReferenceGhost } from '../simulation/AiReferenceGhost';
import { dynamicAiControl } from '../simulation/DynamicAiController';
import { physicalPitControl } from '../simulation/PhysicalPitControl';
import { surfaceEffect } from '../simulation/SurfaceModel';
import { CoreRaceGame } from './CoreRaceGame';
import { RapierRacePhysics } from '../simulation/RapierRacePhysics';
import { createAiField } from '../simulation/RaceModel';
import { createVehicle } from '../simulation/VehicleModel';
import { createTire } from '../simulation/TireModel';
import { PlayerRacingLineCandidateRecorder } from '../simulation/PlayerRacingLineCandidate';
import { createTrackLimitPenaltyState } from '../simulation/TrackLimitPenaltyModel';
import { beginPitStop, createPitStopState, shouldEnterPit, projectPitLane,
  pitEntryProgress, pitExitProgress, pitLanePose,
  pitStopDurationSeconds, pitStopTimeLossEstimateSeconds } from '../simulation/PitLaneModel';
import { projectTrackNear, sampleTrack, setActiveTrack, TRACKS, TRACK_LENGTH } from '../simulation/TrackModel';

const DT = 1 / 120;
beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { setActiveTrack('pitwall-gp'); vi.unstubAllGlobals(); });

function playerTransitSeconds(): number {
  const pose = pitLanePose(0);
  const vehicle = { ...createVehicle(pose.x, pose.y, pose.heading), speed: 88 };
  const physics = new RapierRacePhysics(vehicle, []);
  // Only renderer/input construction and unrelated timing callbacks are bypassed.
  // Transit, limiter, docking, service, tyre change and exit use the live game method.
  const game = Object.assign(Object.create(CoreRaceGame.prototype), {
    vehicle, physics, pitStop: beginPitStop(), keys: new Set(['KeyW']),
    steerInput: 0, tire: createTire('MEDIUM'), selectedCompound: 'MEDIUM',
    usedCompounds: new Set(['MEDIUM']), trackProgress: pitEntryProgress(),
    lineCandidate: new PlayerRacingLineCandidateRecorder(),
    trackLimitPenalty: createTrackLimitPenaltyState(),
    playerCar: { setCompound: vi.fn() },
    updateSectorTiming: () => {}, updateLapAndCheckpoints: () => {},
  });
  let seconds = 0;
  try {
    while (seconds < 45 && game.pitStop.phase !== 'IDLE') {
      game.stepPhysicalPit(DT);
      seconds += DT;
    }
    expect(game.pitStop.phase).toBe('IDLE');
    return seconds;
  } finally { physics.world.free(); }
}

function playerMainlineSeconds(): number {
  const start = pitEntryProgress() - 260 / TRACK_LENGTH;
  const ghost = new AiReferenceGhost(start);
  ghost.driver.tire = createTire('MEDIUM');
  const initial = ghost.physics.aiStates()[0];
  ghost.physics.setAiState(0, { ...initial, speed: 88 });
  const span = (pitExitProgress() - pitEntryProgress() + 1) % 1;
  let previous = start;
  let distance = -260 / TRACK_LENGTH;
  let seconds = 0;
  let started = false;
  try {
    for (let tick = 0; tick < 45 / DT; tick++) {
      ghost.step(DT);
      let delta = ghost.driver.progress - previous;
      if (delta < -0.5) delta += 1;
      if (delta > 0.5) delta -= 1;
      distance += delta;
      previous = ghost.driver.progress;
      if (!started && distance >= 0) started = true;
      if (started) seconds += DT;
      if (started && distance >= span) return seconds;
    }
    throw new Error('Unassisted mainline reference did not reach exit');
  } finally { ghost.physics.world.free(); }
}

// Matched-state race-CPU experiment: every run begins before braking from the
// same pose/velocity/driver/tyre. Gates use accumulated physical progress, never
// elapsed pit time. No stepAiField/tyre wear: this isolates cost from tyre benefit.
function cpuSectionTimes(pit: boolean) {
  const [driver] = createAiField();
  driver.progress = pitEntryProgress() - 260 / TRACK_LENGTH;
  driver.lap = 1;
  driver.pitLap = pit ? 1 : 999;
  driver.tire = createTire('MEDIUM');
  driver.nextCompound = 'MEDIUM'; // isolate stop cost from a compound pace benefit
  driver.pitPlan = [{ plannedLap: 1, compound: 'MEDIUM' }];
  const pose = sampleTrack(driver.progress);
  const remote = sampleTrack(0.5, 260);
  const physics = new RapierRacePhysics(createVehicle(remote.x, remote.y, remote.heading), [driver]);
  physics.setAiState(0, { ...createVehicle(pose.x, pose.y, pose.heading), speed: 88 });
  const span = (pitExitProgress() - pitEntryProgress() + 1) % 1;
  const gates = [0, 200, 400, 600];
  const times: number[] = [];
  const speeds: number[] = [];
  let previous = driver.progress;
  let distance = -260 / TRACK_LENGTH;
  let seconds = 0;
  let enteredAt: number | undefined;
  let exitedAt: number | undefined;
  let entrySpeed: number | undefined;
  let wasPitting = false;
  try {
    for (let tick = 0; tick < 90 / DT; tick++) {
      physics.syncAiKinematics([driver], DT, -10);
      physics.step(DT);
      let delta = driver.progress - previous;
      if (delta < -0.5) delta += 1;
      if (delta > 0.5) delta -= 1;
      distance += delta;
      previous = driver.progress;
      seconds += DT;
      const pitting = physics.isAiPitting(0);
      if (enteredAt === undefined && (pit ? pitting : distance >= 0)) {
        if (pit) expect(driver.lap, 'must enter on the requested lap').toBe(1);
        enteredAt = seconds;
        entrySpeed = physics.aiStates()[0].speed;
      }
      if (pit && wasPitting && !pitting) exitedAt = seconds;
      wasPitting = pitting;
      while (times.length < gates.length && distance >= span + gates[times.length] / TRACK_LENGTH) {
        times.push(seconds);
        speeds.push(physics.aiStates()[0].speed);
      }
      if (times.length === gates.length) {
        if (pit) {
          expect(driver.pitStopIndex).toBe(1);
          expect(exitedAt).toBeDefined();
        }
        return { times, speeds, enteredAt: enteredAt!, entrySpeed: entrySpeed!,
          transit: (exitedAt ?? times[0]) - enteredAt! };
      }
    }
    throw new Error(`CPU ${pit ? 'pit' : 'mainline'} did not reach recovery gate`);
  } finally { physics.world.free(); }
}

// Instrumented player, not a human-feel claim: reference steering on the road,
// scripted braking/merge before entry, then the live CoreRaceGame pit method.
// Both branches start at the identical pose and use the unassisted chassis.
function playerSectionTimes(pit: boolean) {
  const [driver] = createAiField();
  const start = pitEntryProgress() - 260 / TRACK_LENGTH;
  const pose = sampleTrack(start);
  const vehicle = { ...createVehicle(pose.x, pose.y, pose.heading), speed: 88 };
  const physics = new RapierRacePhysics(vehicle, []);
  driver.progress = start;
  driver.lap = 1;
  driver.tire = createTire('MEDIUM');
  const game = Object.assign(Object.create(CoreRaceGame.prototype), {
    vehicle, physics, pitStop: createPitStopState(), keys: new Set(['KeyW']),
    steerInput: 0, tire: driver.tire, selectedCompound: 'MEDIUM',
    usedCompounds: new Set(['MEDIUM']), trackProgress: start,
    lineCandidate: new PlayerRacingLineCandidateRecorder(),
    trackLimitPenalty: createTrackLimitPenaltyState(), playerCar: { setCompound: vi.fn() },
    updateSectorTiming: () => {}, updateLapAndCheckpoints: () => {},
  });
  const span = (pitExitProgress() - pitEntryProgress() + 1) % 1;
  const gates = [0, 200, 400, 600];
  const times: number[] = [];
  const speeds: number[] = [];
  let previous = start;
  let distance = -260 / TRACK_LENGTH;
  let entered = false;
  let exited = false;
  try {
    for (let tick = 0; tick < 90 / DT; tick++) {
      if (game.pitStop.phase !== 'IDLE') {
        game.stepPhysicalPit(DT);
        if (game.pitStop.phase === 'IDLE') exited = true;
      } else {
        const road = projectTrackNear(game.vehicle.x, game.vehicle.y, previous);
        driver.progress = road.progress;
        driver.laneOffset = road.laneOffset;
        driver.speed = game.vehicle.speed;
        driver.tire = game.tire;
        const reference = dynamicAiControl(driver, game.vehicle, []);
        const gap = ((pitEntryProgress() - road.progress + 1) % 1) * TRACK_LENGTH;
        const approach = pit && !entered && gap > 0 && gap < 200;
        const control = approach
          ? physicalPitControl(game.vehicle, beginPitStop(), game.steerInput, DT, 0, 1, 0, true)
          : reference;
        if (approach && game.vehicle.speed > 65) control.steer = reference.steer;
        game.steerInput = control.steer;
        const surface = approach ? { gripMultiplier: 1, powerMultiplier: 1, rollingResistance: 0 }
          : surfaceEffect(road.distance, road.progress);
        physics.drivePlayer({ throttle: control.throttle, brake: control.brake,
          steer: control.steer, tireGrip: game.tire.grip, tireWear: game.tire.wear,
          surfaceGrip: surface.gripMultiplier, powerBoost: 0.22,
          powerMultiplier: surface.powerMultiplier, rollingResistance: surface.rollingResistance }, DT);
        physics.step(DT);
        game.vehicle = physics.playerState();
        const next = projectTrackNear(game.vehicle.x, game.vehicle.y, previous);
        if (pit && !entered && shouldEnterPit(previous, next.progress, next.distance, true, next.laneOffset)) {
          expect(distance, 'player must enter on the first approach, without an extra lap').toBeLessThan(0);
          entered = true;
          game.pitStop = beginPitStop(undefined, projectPitLane(game.vehicle.x, game.vehicle.y, 0).t);
        }
      }
      const progress = projectTrackNear(game.vehicle.x, game.vehicle.y, previous).progress;
      let delta = progress - previous;
      if (delta < -0.5) delta += 1;
      if (delta > 0.5) delta -= 1;
      distance += delta;
      previous = progress;
      while (times.length < gates.length && distance >= span + gates[times.length] / TRACK_LENGTH) {
        times.push((tick + 1) * DT);
        speeds.push(game.vehicle.speed);
      }
      if (times.length === gates.length) {
        if (pit) {
          expect(entered, 'scripted player must enter on its first approach').toBe(true);
          expect(exited, 'scripted player must complete service and exit').toBe(true);
          expect(game.lapPitted).toBe(true);
        }
        return { times, speeds };
      }
    }
    throw new Error(`Player ${pit ? 'pit' : 'mainline'} did not reach recovery gate: ${JSON.stringify({ entered, exited, distance, previous, phase: game.pitStop, vehicle: game.vehicle, control: physicalPitControl(game.vehicle, game.pitStop, game.steerInput, DT), contact: physics.playerContactKind() })}`);
  } finally { physics.world.free(); }
}

it('measures physical player / CPU pit time against the matching mainline entry-to-exit section', () => {
  const rows = TRACKS.map(track => {
    setActiveTrack(track.id);
    const control = cpuSectionTimes(false);
    const stop = cpuSectionTimes(true);
    const mainline = control.times[0] - control.enteredAt;
    const playerMainline = playerMainlineSeconds();
    const cpu = stop.transit;
    const player = playerTransitSeconds();
    const row = { track: track.id, mainline, cpu, player, cpuLoss: cpu - mainline,
      playerMainline, playerLoss: player - playerMainline, durationEstimate: pitStopDurationSeconds(),
      lossEstimate: pitStopTimeLossEstimateSeconds() };
    console.info(`PHYSICAL_PIT_ECONOMICS ${JSON.stringify(row)}`);
    expect(cpu).toBeGreaterThan(row.durationEstimate);
    expect(Math.abs(player - cpu), track.id).toBeLessThan(1.5);
    expect(row.cpuLoss).toBeGreaterThan(0);
    expect(row.playerLoss).toBeGreaterThan(0);
    const losses = stop.times.map((time, index) => time - control.times[index]);
    console.info(`MATCHED_CPU_PIT_COST ${JSON.stringify({ track: track.id,
      startMetresBeforeEntry: 260, initialSpeed: 88, compound: 'MEDIUM',
      recoveryMetres: [0, 200, 400, 600], controlSeconds: control.times,
      stopSeconds: stop.times, netLossSeconds: losses, controlSpeeds: control.speeds,
      stopSpeeds: stop.speeds, approachLoss: stop.enteredAt - control.enteredAt,
      entrySpeed: stop.entrySpeed, transit: stop.transit })}`);
    expect(losses.every(loss => loss > 0), track.id).toBe(true);
    const playerControl = playerSectionTimes(false);
    const playerStop = playerSectionTimes(true);
    const playerLosses = playerStop.times.map((time, index) => time - playerControl.times[index]);
    console.info(`MATCHED_PLAYER_PIT_COST ${JSON.stringify({ track: track.id,
      recoveryMetres: [0, 200, 400, 600], controlSeconds: playerControl.times,
      stopSeconds: playerStop.times, netLossSeconds: playerLosses,
      controlSpeeds: playerControl.speeds, stopSpeeds: playerStop.speeds })}`);
    expect(playerLosses.every(loss => loss > 0), track.id).toBe(true);
    // Keep the requested-lap and completed-stop gates; a missed entry must not
    // masquerade as a cheap pit stop. Recovery samples are diagnostics, not a
    // fabricated requirement that every circuit has recovered by a fixed metre.
    return row;
  });
  expect(rows).toHaveLength(7);
}, 120_000);
