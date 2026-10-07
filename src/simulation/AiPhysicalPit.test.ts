import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { pitEntryProgress, pitStopDurationSeconds } from './PitLaneModel';
import { RapierRacePhysics } from './RapierRacePhysics';
import { createAiField } from './RaceModel';
import { TRACK_ROAD_HALF_WIDTH } from './TrackLimitsModel';
import { projectTrack, sampleTrack, TRACK_LENGTH } from './TrackModel';
import { createVehicle } from './VehicleModel';

const DT = 1 / 120;

beforeAll(async () => { await RAPIER.init(); });

describe('physical AI pit stops', () => {

  it('cannot reach service by elapsed time while its physical pit pose is pinned', () => {
    const [driver] = createAiField();
    driver.lap = driver.pitLap;
    driver.progress = pitEntryProgress() - 0.001;
    const pose = sampleTrack(driver.progress, 11);
    const remote = sampleTrack(0.5, 260);
    const physics = new RapierRacePhysics(createVehicle(remote.x, remote.y, remote.heading), [driver]);
    physics.setAiState(0, { ...createVehicle(pose.x, pose.y, pose.heading), speed: 38 });
    try {
      for (let i = 0; i < 240 && !physics.isAiPitting(0); i++) {
        physics.syncAiKinematics([driver], DT, -10);
        physics.step(DT);
      }
      expect(physics.isAiPitting(0)).toBe(true);
      const pinned = { ...physics.aiStates()[0], speed: 0, yawRate: 0 };
      for (let i = 0; i < 8 / DT; i++) {
        physics.setAiState(0, pinned);
        physics.syncAiKinematics([driver], DT, -10);
        physics.step(DT);
      }
      expect(driver.pitStopIndex).toBe(0);
      expect(physics.isAiPitting(0)).toBe(true);
    } finally { physics.world.free(); }
  });

  it('drives an AI car down pit lane, services it, and rejoins on the same shared timing model', () => {
    const [driver] = createAiField();
    driver.lap = driver.pitLap;
    driver.progress = pitEntryProgress() - 260 / TRACK_LENGTH;
    driver.speed = 88;

    const playerPose = sampleTrack(0.5);
    const physics = new RapierRacePhysics(
      createVehicle(playerPose.x, playerPose.y, playerPose.heading),
      [driver],
    );
    const aiPose = sampleTrack(driver.progress, driver.laneOffset);
    physics.setAiState(0, {
      ...createVehicle(aiPose.x, aiPose.y, aiPose.heading),
      speed: 88,
    });

    let enteredPit = false;
    let pitTicks = 0;
    let maximumPitOffset = 0;
    let completedStop = false;

    for (let tick = 0; tick < 32 / DT; tick++) {
      physics.syncAiKinematics([driver], DT, 1);
      physics.step(DT);

      const pittingNow = physics.isAiPitting(0);
      if (pittingNow) {
        enteredPit = true;
        pitTicks += 1;
      }
      const state = physics.aiStates()[0];
      maximumPitOffset = Math.max(maximumPitOffset, Math.abs(projectTrack(state.x, state.y).laneOffset));

      if (enteredPit && !pittingNow && driver.usedCompounds.has(driver.nextCompound)) {
        completedStop = true;
        break;
      }
    }

    const measuredPitSeconds = pitTicks * DT;
    expect(enteredPit).toBe(true);
    expect(maximumPitOffset).toBeGreaterThan(TRACK_ROAD_HALF_WIDTH * 2);
    expect(completedStop).toBe(true);
    // Physical braking, docking and acceleration now cost more than the old clock estimate.
    expect(measuredPitSeconds).toBeGreaterThan(pitStopDurationSeconds());
    expect(measuredPitSeconds).toBeLessThan(pitStopDurationSeconds() + 8);
    expect(driver.tire.compound).toBe(driver.nextCompound);
    expect(driver.usedCompounds.has(driver.nextCompound)).toBe(true);
    expect(driver.strategyIntent).toBe('DONE');
  }, 20_000);
});

it.each(['approach', 'transit'] as const)('physically reverses a CPU %s wall stall, then completes the stop once clear', stage => {
  const [driver] = createAiField();
  driver.lap = driver.pitLap;
  driver.progress = pitEntryProgress() - (stage === 'approach' ? 65 / TRACK_LENGTH : 0.001);
  const pose = sampleTrack(driver.progress, 11);
  const remote = sampleTrack(0.5, 260);
  const physics = new RapierRacePhysics(createVehicle(remote.x, remote.y, remote.heading), [driver]);
  physics.setAiState(0, { ...createVehicle(pose.x, pose.y, pose.heading), speed: 20 });
  try {
    if (stage === 'transit') {
      for (let tick = 0; tick < 240 && !physics.isAiPitting(0); tick++) {
        physics.syncAiKinematics([driver], DT, -10); physics.step(DT);
      }
      expect(physics.isAiPitting(0)).toBe(true);
    }
    const at = physics.aiStates()[0];
    const wall = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()
      .setTranslation(at.x + Math.cos(at.heading) * 8, at.y + Math.sin(at.heading) * 8)
      .setRotation(at.heading));
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 35), wall);
    let reversedMetres = 0, reverseTicks = 0;
    for (let tick = 0; tick < 8 / DT; tick++) {
      const before = physics.aiStates()[0];
      physics.syncAiKinematics([driver], DT, -10); physics.step(DT);
      const after = physics.aiStates()[0];
      if (physics.aiRecoveryPhase(0) === 'REVERSE') {
        reverseTicks++;
        reversedMetres += Math.max(0, -((after.x - before.x) * Math.cos(before.heading)
          + (after.y - before.y) * Math.sin(before.heading)));
      }
    }
    expect(reverseTicks).toBeGreaterThan(0);
    expect(reversedMetres).toBeGreaterThan(0.5);
    expect(driver.pitStopIndex).toBe(0);
    if (stage === 'approach') expect(physics.isAiPitting(0)).toBe(false);
    physics.world.removeRigidBody(wall);
    for (let tick = 0; tick < 45 / DT && (driver.pitStopIndex === 0 || physics.isAiPitting(0)); tick++) {
      physics.syncAiKinematics([driver], DT, -10); physics.step(DT);
      if (physics.aiPitPhase(0) === 'SERVICE') expect(physics.aiRecoveryPhase(0)).toBe('NORMAL');
    }
    expect(driver.pitStopIndex).toBe(1);
    expect(physics.isAiPitting(0)).toBe(false);
    expect(physics.aiStates()[0].speed).toBeGreaterThan(0);
  } finally { physics.world.free(); }
});

it('backs off a persistent side wall, realigns with the pit lane and completes service', () => {
  const [driver] = createAiField();
  driver.lap = driver.pitLap;
  driver.progress = pitEntryProgress() - 0.001;
  const start = sampleTrack(driver.progress, 11);
  const remote = sampleTrack(0.5, 260);
  const physics = new RapierRacePhysics(createVehicle(remote.x, remote.y, remote.heading), [driver]);
  physics.setAiState(0, { ...createVehicle(start.x, start.y, start.heading), speed: 20 });
  try {
    for (let tick = 0; tick < 240 && !physics.isAiPitting(0); tick++) {
      physics.syncAiKinematics([driver], DT, -10); physics.step(DT);
    }
    expect(physics.isAiPitting(0)).toBe(true);
    const at = physics.aiStates()[0];
    const wall = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()
      .setTranslation(at.x - Math.sin(at.heading) * 8, at.y + Math.cos(at.heading) * 8)
      .setRotation(at.heading));
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.5), wall);
    physics.setAiState(0, { ...at, heading: at.heading + Math.PI / 2, speed: 20, yawRate: 0 });
    let reversed = false;
    for (let tick = 0; tick < 50 / DT && (driver.pitStopIndex === 0 || physics.isAiPitting(0)); tick++) {
      physics.syncAiKinematics([driver], DT, -10); physics.step(DT);
      reversed ||= physics.aiRecoveryPhase(0) === 'REVERSE';
    }
    expect(reversed).toBe(true);
    expect(driver.pitStopIndex).toBe(1);
    expect(physics.isAiPitting(0)).toBe(false);
    expect(physics.world.getRigidBody(wall.handle)).toBeTruthy();
  } finally { physics.world.free(); }
});
