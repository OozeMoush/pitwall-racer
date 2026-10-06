import { RaceSummaryRecorder } from '../simulation/RaceSummaryModel';
import RAPIER from '@dimforge/rapier2d-compat';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { CoreRaceGame } from './CoreRaceGame';
import { RapierRacePhysics } from '../simulation/RapierRacePhysics';
import { createVehicle } from '../simulation/VehicleModel';
import { createTire } from '../simulation/TireModel';
import { createTiming } from '../simulation/TimingModel';
import { createPitStopState, pitServiceSeconds, pitStopDurationSeconds } from '../simulation/PitLaneModel';
import { LapValidityTracker } from '../simulation/LapValidityModel';
import { ImpactDamageTracker } from '../simulation/ImpactDamageTracker';
import { PlayerRacingLineCandidateRecorder } from '../simulation/PlayerRacingLineCandidate';
import { RaceIntervalTracker } from '../simulation/RaceIntervalModel';
import { createTrackLimitPenaltyState } from '../simulation/TrackLimitPenaltyModel';
import { sampleTrack, setActiveTrack } from '../simulation/TrackModel';

beforeAll(async () => { await RAPIER.init(); });
afterEach(() => { vi.unstubAllGlobals(); });

it('starts lap 1 timing at the first start-line crossing instead of the grid', () => {
  setActiveTrack('pitwall-gp');
  vi.stubGlobal('window', { performance, localStorage: { getItem: () => null, setItem: () => {} } });
  const beforeLine = sampleTrack(0.99, 0);
  const vehicle = createVehicle(beforeLine.x, beforeLine.y, beforeLine.heading);
  const physics = new RapierRacePhysics(vehicle, []);
  const game = Object.assign(Object.create(CoreRaceGame.prototype), {
    setup: { trackId: 'pitwall-gp' }, totalLaps: 10, ai: [], vehicle, physics,
    tire: createTire('SOFT'),
    timing: { ...createTiming(), raceTime: 4.5, currentLapTime: 4.5 },
    flow: { phase: 'RACING', countdown: 0, goFlash: 0 },
    keys: new Set(), pitStop: createPitStopState(), selectedCompound: 'MEDIUM',
    usedCompounds: new Set(['SOFT']), lap: 0, trackProgress: 0.01,
    lastTrackProgress: 0.99, lapForwardProgress: 0, pitRequested: false,
    steerInput: 0, trafficPressure: 0, nextSector: 3, sectorStartTime: 0,
    sectorTimes: [1.2, 1.3], sectorTones: [], lapHistory: [],
    lapStartCompound: 'SOFT', lapPitted: false, sessionFastestSectors: [],
    summaryRecorder: new RaceSummaryRecorder({trackId:'pitwall-gp',trackRevision:'test',totalLaps:10,startCompound:'SOFT',gridOrder:[],line:{source:'AUTO',fingerprint:'auto'},rulesVersion:'test'}),
    aiLapClocks: new Map(), raceIntervals: new RaceIntervalTracker(),
    lapValidity: new LapValidityTracker(), lineCandidate: new PlayerRacingLineCandidateRecorder(),
    trackLimitPenalty: createTrackLimitPenaltyState(), impactDamage: new ImpactDamageTracker(),
    playerCar: { setCompound: vi.fn() }, launchEffectRemaining: 0,
  });
  try {
    game.updateLapAndCheckpoints(0);
    expect(game.lap).toBe(1);
    expect(game.timing.lapStartTime).toBeCloseTo(4.5, 6);
    expect(game.timing.currentLapTime).toBe(0);
    expect(game.nextSector).toBe(1);
    expect(game.sectorStartTime).toBeCloseTo(4.5, 6);
    expect(game.sectorTimes).toEqual([]);
  } finally {
    physics.world.free();
  }
});

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
    summaryRecorder: new RaceSummaryRecorder({trackId:'pitwall-gp',trackRevision:'test',totalLaps:10,startCompound:'SOFT',gridOrder:[],line:{source:'AUTO',fingerprint:'auto'},rulesVersion:'test'}),
    aiLapClocks: new Map(), raceIntervals: new RaceIntervalTracker(), lapValidity: new LapValidityTracker(),
    lineCandidate: new PlayerRacingLineCandidateRecorder(),
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
    // Five distinct all-wheel excursions award the 5s GP penalty. The line
    // becomes ineligible earlier, but the physical lap itself still counts.
    for (let tick = 1; tick <= 3600; tick++) {
      const p = tick / 3600;
      const outside = [0.12, 0.2, 0.27, 0.45, 0.61].some(at => Math.abs(p - at) < 0.003);
      traverse(p, outside ? 21 : 0);
    }
    expect(game.trackLimitPenalty.pendingPitSeconds).toBe(5);
    expect(game.lap).toBe(3);
    expect(game.lapHistory[1].valid).toBe(true);
    expect(game.summaryRecorder.snapshot().laps).toHaveLength(2);
    expect(game.summaryRecorder.snapshot().laps[1]).toMatchObject({driverId:'player',lap:2,counted:true});
    expect(game.lapHistory[1].lapTime).toBeCloseTo(30, 1);
    expect(game.lapHistory[1].s1).toBeCloseTo(10, 1);
    expect(game.lapHistory[1].s2).toBeCloseTo(10, 1);
    expect(game.lapHistory[1].s3).toBeCloseTo(10, 1);
    game.pitRequested = true;
    for (let tick = 1; tick < 3600 && game.pitStop.phase === 'IDLE'; tick++) {
      const p = tick / 3600;
      traverse(p, p > 0.88 ? 11 : 0);
    }
    expect(game.pitStop.phase).toBe('TRANSIT_IN');
    game.keys.add('KeyW');
    const pitDeadlineTicks = Math.ceil((pitStopDurationSeconds() + 20) * 120);
    for (let tick = 0; tick < pitDeadlineTicks && game.pitStop.phase !== 'SERVICE'; tick++) game.stepSimulation(1 / 120);
    expect(game.pitStop.phase).toBe('SERVICE');
    expect(game.pitStop.serviceRemaining).toBeCloseTo(pitServiceSeconds() + 5, 5);
    expect(game.trackLimitPenalty.pendingPitSeconds).toBe(0);
    for (let tick = 0; tick < pitDeadlineTicks * 2 && game.pitStop.phase !== 'IDLE'; tick++) game.stepSimulation(1 / 120);
    game.keys.delete('KeyW');
    expect(game.pitStop.phase).toBe('IDLE');
    expect(game.tire.compound).toBe('MEDIUM');
    const summary = game.summaryRecorder.snapshot();
    expect(summary.events.map((row: {kind:string})=>row.kind)).toEqual(['PIT_IN','SERVICE','PIT_OUT','REJOIN']);
    expect(summary.events.at(-1).compound).toBe('MEDIUM');
    expect(game.lap).toBe(4);
  } finally { physics.world.free(); }
}, 20_000);
