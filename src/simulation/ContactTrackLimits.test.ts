import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { LapValidityTracker, isEntireCarBeyondTrackAt } from './LapValidityModel';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField } from './RaceModel';
import { sampleTrack, setActiveTrack } from './TrackModel';
import { CoreRaceGame } from '../game/CoreRaceGame';
import { createTrackLimitPenaltyState } from './TrackLimitPenaltyModel';
import { createVehicle } from './VehicleModel';

const dt = 1 / 120;
describe('contact-caused track-limit exemption', () => {
  it('exempts an immediate or delayed exit toward a car push, until returning', () => {
    const t = new LapValidityTracker();
    t.sample(18, 0, 0, dt, 2);
    expect(t.sample(20, 0, 0, 0.3)).toBe('NONE');
    expect(t.sample(23, 0, 0, 3)).toBe('NONE');
    expect(t.warnings).toBe(0);
    t.sample(0, 0, 0, dt);
    expect(t.sample(20, 0, 0, dt)).toBe('WARNING');
  });
  it('does not excuse a later independent cut, opposite-direction exit or tiny rub', () => {
    for (const [delay, exit, push] of [[0.76, 20, 2], [0.1, -20, 2], [0.1, 20, 0.1]]) {
      const t = new LapValidityTracker();
      t.sample(18, 0, 0, dt, push);
      expect(t.sample(exit, 0, 0, delay)).toBe('WARNING');
    }
  });
  it('does not undo a counted exit when contact occurs already outside', () => {
    const t = new LapValidityTracker();
    expect(t.sample(20, 0, 0, dt)).toBe('WARNING');
    t.sample(21, 0, 0, dt, 3);
    t.sample(0, 0, 0, dt);
    expect(t.sample(20, 0, 0, dt)).toBe('WARNING');
    expect(t.warnings).toBe(2);
  });
  it('preserves an ongoing excursion across laps but clears grace on restart/recovery', () => {
    const t = new LapValidityTracker();
    t.sample(20, 0, 0, dt, -2); // wrong-direction exit counts
    t.reset(true);
    expect(t.sample(20, 0, 0, dt)).toBe('NONE');
    t.reset();
    t.sample(18, 0, 0, dt, 2);
    t.clearContactGrace();
    expect(t.sample(20, 0, 0, dt)).toBe('WARNING');
    t.reset();
    expect(t.sample(20, 0, 0, dt)).toBe('WARNING');
  });
  it('leaves ordinary third-excursion invalidation intact', () => {
    const t = new LapValidityTracker();
    t.sample(20, 0, 0, dt, 2);
    expect(t.invalid).toBe(false);
    for (let i = 0; i < 3; i++) { t.sample(0, 0, 0, dt); t.sample(20, 0, 0, dt); }
    expect(t.warnings).toBe(3);
    expect(t.invalid).toBe(true);
  });

  it('keeps race warning and penalty counters untouched for a pushed exit, then counts normal cuts', () => {
    setActiveTrack('pitwall-gp');
    const p = sampleTrack(0.42, 20);
    const push = { x: -Math.sin(p.heading) * 2, y: Math.cos(p.heading) * 2 };
    let currentPush = push;
    let marked = 0;
    const game = Object.assign(Object.create(CoreRaceGame.prototype), {
      vehicle: createVehicle(p.x, p.y, p.heading), lapValidity: new LapValidityTracker(),
      physics: { playerCarPushVelocity: () => currentPush },
      trackLimitPenalty: createTrackLimitPenaltyState(), lineCandidate: { markIneligible: () => marked++ },
    }) as any;
    game.updateTrackLimits(dt);
    expect(game.trackLimitPenalty).toEqual({ warnings: 0, pendingPitSeconds: 0 });
    expect(marked).toBe(0);
    currentPush = { x: 0, y: 0 };
    const road = sampleTrack(0.42);
    game.vehicle = createVehicle(road.x, road.y, road.heading); game.updateTrackLimits(dt);
    game.vehicle = createVehicle(p.x, p.y, p.heading); game.updateTrackLimits(dt);
    expect(game.trackLimitPenalty.warnings).toBe(1);
    expect(game.racePenaltyNotice).toContain('WARNING'); expect(marked).toBe(1);
  });

  beforeAll(async () => { await RAPIER.init(); setActiveTrack('pitwall-gp'); });
  it('uses actual Rapier lateral impulse for a physical push beyond the white line', () => {
    const progress = 0.42;
    const pose = sampleTrack(progress, 18);
    const ai = createAiField()[0]; ai.progress = progress; ai.laneOffset = 12;
    const physics = new RapierRacePhysics(createVehicle(pose.x, pose.y, pose.heading), [ai]);
    const attacker = sampleTrack(progress, 12);
    physics.setAiState(0, { ...createVehicle(attacker.x, attacker.y, attacker.heading + Math.PI / 2), speed: 16 });
    const t = new LapValidityTracker();
    let sawPush = false; let sawOutside = false;
    try {
      t.sampleWorld(pose.x, pose.y, pose.heading, dt);
      for (let i = 0; i < 70; i++) {
        physics.step(dt);
        const car = physics.playerState(); const push = physics.playerCarPushVelocity();
        const lateral = -Math.sin(pose.heading) * push.x + Math.cos(pose.heading) * push.y;
        sawPush ||= lateral > 0.3;
        sawOutside ||= isEntireCarBeyondTrackAt(car.x, car.y, car.heading);
        expect(t.sampleWorld(car.x, car.y, car.heading, dt, push)).toBe('NONE');
      }
      expect(sawPush).toBe(true); expect(sawOutside).toBe(true); expect(t.warnings).toBe(0);
      physics.setPlayerState(createVehicle(pose.x, pose.y, pose.heading));
      expect(physics.playerCarPushVelocity()).toEqual({ x: 0, y: 0 });
    } finally { physics.world.free(); }
  });
});
