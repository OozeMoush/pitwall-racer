import RAPIER from '@dimforge/rapier2d-compat';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { CoreRaceGame } from './CoreRaceGame';
import { RapierRacePhysics } from '../simulation/RapierRacePhysics';
import { createVehicle } from '../simulation/VehicleModel';
import { createTire } from '../simulation/TireModel';
import { createTiming } from '../simulation/TimingModel';
import { createPitStopState } from '../simulation/PitLaneModel';
import { LapValidityTracker } from '../simulation/LapValidityModel';
import { ImpactDamageTracker } from '../simulation/ImpactDamageTracker';
import { PlayerRacingLineCandidateRecorder } from '../simulation/PlayerRacingLineCandidate';
import { RaceRacingLineCandidateFilter } from '../simulation/RaceRacingLineCandidatePolicy';
import { RaceIntervalTracker } from '../simulation/RaceIntervalModel';
import { createTrackLimitPenaltyState } from '../simulation/TrackLimitPenaltyModel';
import { sampleTrack, setActiveTrack } from '../simulation/TrackModel';

beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { vi.unstubAllGlobals(); });

it('counts GP laps and all sectors on kerbs, then enters and serves a requested pit after warnings', () => {
  setActiveTrack('pitwall-gp');
  vi.stubGlobal('window', { performance, localStorage: { getItem: () => null, setItem: () => {} } });
  const start = sampleTrack(0, 0);
  const vehicle = createVehicle(start.x, start.y, start.heading);
  const physics = new RapierRacePhysics(vehicle, []);
  // Bypass WebGL/input construction only. Exercise the actual fixed-step game,
  // timing, rules and pit code with prescribed physical poses, not a copy of it.
  const game = Object.assign(Object.create(CoreRaceGame.prototype), {
    setup: { trackId: 'pitwall-gp' }, totalLaps: 10, ai: [], vehicle, physics,
    tire: createTire('SOFT'), timing: createTiming(), flow: { phase: 'RACING', countdown: 0, goFlash: 0 },
    keys: new Set(), pitStop: createPitStopState(), selectedCompound: 'MEDIUM', usedCompounds: new Set(['SOFT']),
    lap: 1, trackProgress: 0, lastTrackProgress: 0, lapForwardProgress: 0, pitRequested: false,
    steerInput: 0, trafficPressure: 0, nextSector: 1, sectorStartTime: 0, sectorTimes: [], sectorTones: [],
    lapHistory: [], lapStartCompound: 'SOFT', lapPitted: false, sessionFastestSectors: [],
    aiLapClocks: new Map(), raceIntervals: new RaceIntervalTracker(), lapValidity: new LapValidityTracker(),
    lineCandidate: new PlayerRacingLineCandidateRecorder(), lineCandidateFilter: new RaceRacingLineCandidateFilter(),
    trackLimitPenalty: createTrackLimitPenaltyState(), impactDamage: new ImpactDamageTracker(),
    playerCar: { setCompound: vi.fn() }, launchEffectRemaining: 0,
  });
  game.beginRaceLineCandidate();
  const traverse = (progress: number, lane: number) => {
    const pose = sampleTrack(progress % 1, lane);
    game.vehicle = { ...createVehicle(pose.x, pose.y, pose.heading), speed: 1 };
    physics.setPlayerState(game.vehicle);
    game.stepSimulation(1 / 120);
  };
  try {
    // Ordinary kerb use at both sector gates and the finish; no false warnings.
    for (let tick = 1; tick <= 3600; tick++) {
      const p = tick / 3600;
      const kerb = Math.abs(p - 1 / 3) < 0.005 || Math.abs(p - 2 / 3) < 0.005 || p > 0.995;
      traverse(p, kerb ? 18 : 0);
    }
    expect(game.lap).toBe(2);
    expect(game.trackLimitPenalty.warnings).toBe(0);
    const clean = game.lapHistory[0];
    expect(clean.s1).toBeCloseTo(10, 1);
    expect(clean.s2).toBeCloseTo(10, 1);
    expect(clean.s3).toBeCloseTo(10, 1);
    // Three distinct all-wheel excursions disqualify the line, never the lap.
    for (let tick = 1; tick <= 3600; tick++) {
      const p = tick / 3600;
      const outside = [0.12, 0.2, 0.27].some(at => Math.abs(p - at) < 0.003);
      traverse(p, outside ? 21 : 0);
    }
    expect(game.trackLimitPenalty.pendingPitSeconds).toBe(5);
    expect(game.lap).toBe(3);
    expect(game.lapHistory[1].valid).toBe(true);
    expect(game.lapHistory[1].lapTime).toBeCloseTo(30, 1);
    expect(game.lapHistory[1].s1).toBeCloseTo(10, 1);
    expect(game.lapHistory[1].s2).toBeCloseTo(10, 1);
    expect(game.lapHistory[1].s3).toBeCloseTo(10, 1);
    game.pitRequested = true;
    for (let tick = 1; tick < 3600 && game.pitStop.phase === 'IDLE'; tick++) traverse(tick / 3600, 0);
    expect(game.pitStop.phase).toBe('TRANSIT_IN');
    for (let tick = 0; tick < 2400 && game.pitStop.phase !== 'SERVICE'; tick++) game.stepSimulation(1 / 120);
    expect(game.pitStop.phase).toBe('SERVICE');
    expect(game.pitStop.serviceRemaining).toBeGreaterThan(7);
    expect(game.trackLimitPenalty.pendingPitSeconds).toBe(0);
    for (let tick = 0; tick < 2400 && game.pitStop.phase !== 'IDLE'; tick++) game.stepSimulation(1 / 120);
    expect(game.pitStop.phase).toBe('IDLE');
    expect(game.tire.compound).toBe('MEDIUM');
    expect(game.lap).toBe(4);
  } finally { physics.world.free(); }
}, 20_000);
