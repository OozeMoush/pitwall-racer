import RAPIER from '@dimforge/rapier2d-compat';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { CoreRaceGame } from './CoreRaceGame';
import { RapierRacePhysics } from '../simulation/RapierRacePhysics';
import { createVehicle } from '../simulation/VehicleModel';
import { createTire } from '../simulation/TireModel';
import { PlayerRacingLineCandidateRecorder } from '../simulation/PlayerRacingLineCandidate';
import { createTrackLimitPenaltyState } from '../simulation/TrackLimitPenaltyModel';
import { createPitStopState, pitEntryProgress, pitLanePose, shouldEnterPit } from '../simulation/PitLaneModel';
import { projectTrack, setActiveTrack, TRACKS, TRACK_LENGTH } from '../simulation/TrackModel';

beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { setActiveTrack('pitwall-gp'); vi.unstubAllGlobals(); });

it.each(TRACKS.map(track => track.id))('completes %s service after entry without precise pedal or steering input', trackId => {
  setActiveTrack(trackId);
  for (const input of [
    { startT: 0, speed: 22, offset: 3, heading: -0.10, keys: [] },
    { startT: 0.025, speed: 40, offset: -3, heading: 0.10, keys: ['KeyD'] },
    { startT: 0.025, speed: 65, offset: 0, heading: 0, keys: ['KeyW', 'KeyS'] },
  ]) {
    const pose = pitLanePose(input.startT);
    const vehicle = { ...createVehicle(pose.x - Math.sin(pose.heading) * input.offset,
      pose.y + Math.cos(pose.heading) * input.offset, pose.heading + input.heading), speed: input.speed };
    const physics = new RapierRacePhysics(vehicle, []);
    const game = Object.assign(Object.create(CoreRaceGame.prototype), {
      vehicle, physics, pitStop: createPitStopState(), pitRequested: true, keys: new Set(input.keys),
      steerInput: input.keys.includes('KeyD') ? 0.75 : 0, tire: createTire('MEDIUM'), selectedCompound: 'HARD',
      usedCompounds: new Set(['MEDIUM']), trackProgress: pitEntryProgress(),
      lineCandidate: new PlayerRacingLineCandidateRecorder(),
      trackLimitPenalty: createTrackLimitPenaltyState(), playerCar: { setCompound: vi.fn() },
      updateSectorTiming: () => {}, updateLapAndCheckpoints: () => {},
    });
    const road = projectTrack(vehicle.x, vehicle.y);
    const previous = road.progress - 0.1 / TRACK_LENGTH;
    // Already past the single crossing tick: the old gate never committed.
    if (input.startT > 0) expect(shouldEnterPit(previous, road.progress, road.distance, true, road.laneOffset)).toBe(false);
    game.tryEnterPlayerPit(previous, road.progress, road.distance, road.laneOffset);
    expect(game.pitStop.phase, JSON.stringify(input)).toBe('TRANSIT_IN');
    expect(game.pitRequested).toBe(false);
    let serviced = false;
    try {
      for (let tick = 0; tick < 50 * 120 && game.pitStop.phase !== 'IDLE'; tick++) {
        game.stepPhysicalPit(1 / 120);
        serviced ||= game.pitStop.phase === 'SERVICE';
      }
      expect(serviced, JSON.stringify(input)).toBe(true);
      expect(game.pitStop.phase, JSON.stringify(input)).toBe('IDLE');
      expect(game.tire.compound).toBe('HARD');
      expect(game.playerCar.setCompound).toHaveBeenCalledTimes(1);
      expect(game.vehicle.speed).toBeGreaterThan(0);
    } finally { physics.world.free(); }
  }
}, 60_000);

it('cannot complete player service while the physical body is pinned before the box', () => {
  const pose = pitLanePose(0.025);
  const vehicle = createVehicle(pose.x, pose.y, pose.heading);
  const physics = new RapierRacePhysics(vehicle, []);
  const game = Object.assign(Object.create(CoreRaceGame.prototype), {
    vehicle, physics, pitStop: createPitStopState(), pitRequested: true, keys: new Set(),
    steerInput: 0, tire: createTire('MEDIUM'), selectedCompound: 'HARD',
    usedCompounds: new Set(['MEDIUM']), trackProgress: pitEntryProgress(),
    lineCandidate: new PlayerRacingLineCandidateRecorder(),
    trackLimitPenalty: createTrackLimitPenaltyState(), playerCar: { setCompound: vi.fn() },
    updateSectorTiming: () => {}, updateLapAndCheckpoints: () => {},
  });
  const road = projectTrack(vehicle.x, vehicle.y);
  game.tryEnterPlayerPit(road.progress - 0.1 / TRACK_LENGTH, road.progress, road.distance, road.laneOffset);
  expect(game.pitStop.phase).toBe('TRANSIT_IN');
  try {
    for (let tick = 0; tick < 10 * 120; tick++) {
      game.vehicle = vehicle;
      physics.setPlayerState(vehicle);
      game.stepPhysicalPit(1 / 120);
    }
    expect(game.pitStop.phase).toBe('TRANSIT_IN');
    expect(game.pitStop.tyreChanged).toBe(false);
    expect(game.playerCar.setCompound).not.toHaveBeenCalled();
  } finally { physics.world.free(); }
});

it('offers C recovery after a real pit-lane barrier stall without skipping transit or service', () => {
  const pose = pitLanePose(0.025);
  const vehicle = createVehicle(pose.x, pose.y, pose.heading);
  const physics = new RapierRacePhysics(vehicle, []);
  // Deterministic physical obstruction across the entry lane. No mocked contact.
  const wall = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()
    .setTranslation(pose.x + Math.cos(pose.heading) * 5, pose.y + Math.sin(pose.heading) * 5)
    .setRotation(pose.heading));
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 20), wall);
  const game = Object.assign(Object.create(CoreRaceGame.prototype), {
    vehicle, physics, pitStop: createPitStopState(), pitRequested: true, flow: { phase: 'RACING' }, lap: 1,
    steerInput: 0, tire: createTire('MEDIUM'), selectedCompound: 'HARD',
    usedCompounds: new Set(['MEDIUM']), trackProgress: pitEntryProgress(), trackDistance: 0,
    lineCandidate: new PlayerRacingLineCandidateRecorder(), lapValidity: { invalidate: vi.fn() },
    trackLimitPenalty: createTrackLimitPenaltyState(), playerCar: { setCompound: vi.fn() },
    updateSectorTiming: () => {}, updateLapAndCheckpoints: () => {},
  });
  const road = projectTrack(vehicle.x, vehicle.y);
  game.tryEnterPlayerPit(road.progress - 0.1 / TRACK_LENGTH, road.progress, road.distance, road.laneOffset);
  try {
    expect(game.canRecoverPlayer()).toBe(false);
    for (let tick = 0; tick < 8 * 120; tick++) game.stepPhysicalPit(1 / 120);
    expect(game.vehicle.speed).toBeLessThan(2.2);
    expect(game.canRecoverPlayer()).toBe(true);
    expect(game.pitStop.phase).toBe('TRANSIT_IN');
    const t = game.pitStop.t;
    const tyre = game.tire;
    game.handleRecoveryOrRestart();
    expect(game.pitStop.t).toBe(t);
    expect(game.pitStop.phase).toBe('TRANSIT_IN');
    expect(game.tire).toBe(tyre);
    expect(game.playerCar.setCompound).not.toHaveBeenCalled();
    expect(game.canRecoverPlayer()).toBe(false);
    expect(game.lapValidity.invalidate).toHaveBeenCalledOnce();
    physics.world.removeRigidBody(wall);
    for (let tick = 0; tick < 50 * 120 && game.pitStop.phase !== 'IDLE'; tick++) game.stepPhysicalPit(1 / 120);
    expect(game.pitStop.phase).toBe('IDLE');
    expect(game.playerCar.setCompound).toHaveBeenCalledOnce();
  } finally { physics.world.free(); }
});
it('allows a requested-entry wall recovery near the road but never captures a pit by pressing C', () => {
  const pose = pitLanePose(0);
  const vehicle = createVehicle(pose.x, pose.y, pose.heading);
  const physics = new RapierRacePhysics(vehicle, []);
  const wall = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pose.x, pose.y));
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(4, 4), wall);
  const game = Object.assign(Object.create(CoreRaceGame.prototype), {
    vehicle, physics, pitStop: createPitStopState(), pitRequested: true,
    flow: { phase: 'RACING' }, lap: 0, trackDistance: 10, trackProgress: pitEntryProgress(),
  });
  try {
    physics.step(1 / 120);
    game.vehicle = physics.playerState();
    expect(physics.playerTouchesBarrier()).toBe(true);
    expect(game.canRecoverPlayer()).toBe(true);
    game.handleRecoveryOrRestart();
    expect(game.pitStop.phase).toBe('IDLE');
    expect(game.pitRequested).toBe(true);
    game.vehicle = { ...game.vehicle, speed: 10 };
    expect(game.canRecoverPlayer()).toBe(false);
  } finally { physics.world.free(); }
});
