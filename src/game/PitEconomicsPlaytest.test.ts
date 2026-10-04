import RAPIER from '@dimforge/rapier2d-compat';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { AiReferenceGhost } from '../simulation/AiReferenceGhost';
import { CoreRaceGame } from './CoreRaceGame';
import { RapierRacePhysics } from '../simulation/RapierRacePhysics';
import { createAiField } from '../simulation/RaceModel';
import { createVehicle } from '../simulation/VehicleModel';
import { createTire } from '../simulation/TireModel';
import { PlayerRacingLineCandidateRecorder } from '../simulation/PlayerRacingLineCandidate';
import { createTrackLimitPenaltyState } from '../simulation/TrackLimitPenaltyModel';
import { beginPitStop, pitEntryProgress, pitExitProgress, pitLanePose,
  pitStopDurationSeconds, pitStopTimeLossEstimateSeconds } from '../simulation/PitLaneModel';
import { sampleTrack, setActiveTrack, TRACKS, TRACK_LENGTH } from '../simulation/TrackModel';

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

function cpuTransitSeconds(pit: boolean): number {
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
  let previous = driver.progress;
  let distance = -260 / TRACK_LENGTH;
  let seconds = 0;
  let started = false;
  try {
    for (let tick = 0; tick < 45 / DT; tick++) {
      physics.syncAiKinematics([driver], DT, -10);
      physics.step(DT);
      let delta = driver.progress - previous;
      if (delta < -0.5) delta += 1;
      if (delta > 0.5) delta -= 1;
      distance += delta;
      previous = driver.progress;
      if (!started && (pit ? physics.isAiPitting(0) : distance >= 0)) {
        if (pit) expect(driver.lap, 'must enter on the requested lap').toBe(1);
        started = true;
      }
      if (started) seconds += DT;
      if (started && (pit ? !physics.isAiPitting(0) : distance >= span)) return seconds;
    }
    throw new Error(`CPU ${pit ? 'pit' : 'mainline'} did not reach exit`);
  } finally { physics.world.free(); }
}

it('measures physical player / CPU pit time against the matching mainline entry-to-exit section', () => {
  const rows = TRACKS.map(track => {
    setActiveTrack(track.id);
    const mainline = cpuTransitSeconds(false);
    const playerMainline = playerMainlineSeconds();
    const cpu = cpuTransitSeconds(true);
    const player = playerTransitSeconds();
    const row = { track: track.id, mainline, cpu, player, cpuLoss: cpu - mainline,
      playerMainline, playerLoss: player - playerMainline, durationEstimate: pitStopDurationSeconds(),
      lossEstimate: pitStopTimeLossEstimateSeconds() };
    console.info(`PHYSICAL_PIT_ECONOMICS ${JSON.stringify(row)}`);
    expect(cpu).toBeGreaterThan(row.durationEstimate);
    expect(Math.abs(player - cpu), track.id).toBeLessThan(1.5);
    expect(row.cpuLoss).toBeGreaterThan(0);
    expect(row.playerLoss).toBeGreaterThan(0);
    return row;
  });
  expect(rows).toHaveLength(7);
}, 120_000);
