import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, expect, it } from 'vitest';
import { RapierRacePhysics, CAR_COLLIDER_HALF_LENGTH, CAR_COLLIDER_HALF_WIDTH } from '../RapierRacePhysics';
import { createAiField, stepAiField, type DriverState } from '../RaceModel';
import { resolveAiOccupancy } from '../AiOccupancyModel';
import { gridSlotForPosition } from '../GridModel';
import { dynamicAiControl } from '../DynamicAiController';
import { surfaceEffect } from '../SurfaceModel';
import { projectTrackNear, sampleTrack, setActiveTrack, TRACK_LENGTH } from '../TrackModel';
import { trackRoadHalfWidth } from '../TrackLimitsModel';
import { createVehicle } from '../VehicleModel';
import { createTire } from '../TireModel';
import { pitEntryProgress } from '../PitLaneModel';
const DT = 1 / 120;
beforeAll(async () => { await RAPIER.init(); setActiveTrack('pitwall-gp'); });
function pair(enabled: boolean, block: boolean) {
  const ego = { ...createAiField()[1], lap: 1, progress: 0.04, laneOffset: 0, pitPlan: [] };
  const rival = { ...ego, id: 'player', progress: ego.progress + 40 / TRACK_LENGTH, tire: createTire('MEDIUM') };
  const pose = sampleTrack(rival.progress), back = sampleTrack(ego.progress);
  const physics = new RapierRacePhysics(createVehicle(pose.x, pose.y, pose.heading), [ego], enabled);
  physics.setPlayerState({ ...createVehicle(pose.x, pose.y, pose.heading), speed: 65 });
  physics.setAiState(0, { ...createVehicle(back.x, back.y, back.heading), speed: 75 });
  const result = { contactSeconds: 0, offroadSeconds: 0, phases: [] as string[],
    decisions: [] as string[], maxLane: 0, finalGap: 0, controllerMs: 0 };
  let previousPhase = '';
  try {
    for (let tick = 0; tick < 20 / DT; tick++) {
      const player = physics.playerState(), ai = physics.aiStates()[0];
      const road = projectTrackNear(player.x, player.y, rival.progress);
      if (rival.progress > 0.88 && road.progress < 0.12) rival.lap++;
      rival.progress = road.progress; rival.speed = player.speed; rival.laneOffset = road.laneOffset;
      const normal = dynamicAiControl(rival, player, []);
      let steer = normal.steer;
      if (block && tick * DT >= 0.35 && tick * DT < 3) {
        const target = sampleTrack(rival.progress + Math.max(25, player.speed * 0.5) / TRACK_LENGTH, 6);
        const angle = Math.atan2(target.y - player.y, target.x - player.x) - player.heading;
        steer = Math.max(-0.98, Math.min(0.98, Math.atan2(Math.sin(angle), Math.cos(angle)) * 2.5 - player.yawRate * 0.4));
      }
      const surface = surfaceEffect(road.distance);
      const cap = Math.min(normal.targetSpeed, 65);
      physics.drivePlayer({ throttle: player.speed < cap ? 1 : 0,
        brake: Math.max(normal.brake, Math.min(1, Math.max(0, (player.speed - cap) / 8))),
        steer, tireGrip: rival.tire.grip, surfaceGrip: surface.gripMultiplier, powerBoost: 0.22,
        powerMultiplier: surface.powerMultiplier, rollingResistance: surface.rollingResistance }, DT);
      const start = performance.now();
      physics.syncAiKinematics([ego], DT, rival.lap);
      if (tick >= 120) result.controllerMs += performance.now() - start;
      physics.step(DT);
      const snapshot = physics.passingStates()[0];
      if (snapshot && snapshot.phase !== previousPhase) { result.phases.push(snapshot.phase); previousPhase = snapshot.phase; }
      if (snapshot?.reason && !result.decisions.includes(snapshot.reason)) result.decisions.push(snapshot.reason);
      result.maxLane = Math.max(result.maxLane, Math.abs(ego.laneOffset));
      result.finalGap = ((rival.lap - ego.lap) + rival.progress - ego.progress) * TRACK_LENGTH;
      let contact = false;
      physics.world.forEachCollider(collider => {
        if (!collider.parent()?.isDynamic()) return;
        physics.world.contactPairsWith(collider, other => physics.world.contactPair(collider, other, manifold => {
          for (let i = 0; i < manifold.numContacts(); i++) if (manifold.contactDist(i) <= 0) contact = true;
        }));
      });
      if (contact) result.contactSeconds += DT;
      const after = physics.aiStates()[0];
      const projected = projectTrackNear(after.x, after.y, ego.progress);
      const angle = after.heading - sampleTrack(projected.progress).heading;
      const extent = Math.abs(Math.sin(angle)) * CAR_COLLIDER_HALF_LENGTH + Math.abs(Math.cos(angle)) * CAR_COLLIDER_HALF_WIDTH;
      if (projected.distance + extent > trackRoadHalfWidth(projected.progress)) result.offroadSeconds += DT;
    }
    result.controllerMs /= 2280;
    return result;
  } finally { physics.world.free(); }
}
it('exercises the actual GP sync controller with old/new pair traffic and existing hardware', () => {
  for (const block of [false, true]) {
    const before = pair(false, block), result = pair(true, block), repeat = pair(true, block);
    const { controllerMs: _cost, ...physical } = result;
    const { controllerMs: _repeatCost, ...repeated } = repeat;
    expect(repeated).toEqual(physical);
    console.info('GP_PASSING_PAIR', JSON.stringify({ block, before, result }));
    expect(result.phases).toContain('COMMIT');
    expect(result.contactSeconds).toBe(0);
    expect(result.offroadSeconds).toBe(0);
    expect(result.controllerMs).toBeLessThan(5);
    if (block) {
      expect(result.decisions).toContain('early defence');
      expect(result.finalGap).toBeGreaterThan(22);
    } else {
      expect(result.finalGap).toBeLessThan(-22);
      expect(result.phases).toContain('FOLLOW');
    }
  }
}, 60_000);
it('runs the seven-CPU GP grid, wear and traffic with no teleport or nonfinite bodies', () => {
  for (const enabled of [false, true]) {
    let drivers = createAiField(undefined, 14);
    const slot = gridSlotForPosition(8), pose = sampleTrack(slot.progress, slot.laneOffset);
    const physics = new RapierRacePhysics(createVehicle(pose.x, pose.y, pose.heading), drivers, enabled);
    let player: DriverState = { ...drivers[0], id: 'player', lap: 0, progress: slot.progress, tire: createTire('MEDIUM') };
    let cpuMs = 0, samples = 0, maxOffset = 0, actions = 0;
    try {
      for (let tick = 0; tick < 70 / DT; tick++) {
        const state = physics.playerState(), projection = projectTrackNear(state.x, state.y, player.progress);
        if (player.progress > 0.88 && projection.progress < 0.12) player.lap++;
        player = { ...player, progress: projection.progress, speed: state.speed, laneOffset: projection.laneOffset };
        const control = dynamicAiControl(player, state, []), surface = surfaceEffect(projection.distance);
        physics.drivePlayer({ throttle: control.throttle, brake: control.brake, steer: control.steer,
          tireGrip: player.tire.grip, surfaceGrip: surface.gripMultiplier, powerBoost: 0.22,
          powerMultiplier: surface.powerMultiplier, rollingResistance: surface.rollingResistance }, DT);
        drivers = stepAiField(drivers, DT, 14, [{ ...player, performance: 1, isPlayer: true }], false);
        drivers = resolveAiOccupancy(drivers, DT);
        const start = performance.now(); physics.syncAiKinematics(drivers, DT, player.lap); cpuMs += performance.now() - start; samples++;
        physics.step(DT);
        for (const [index, car] of physics.aiStates().entries()) {
          expect(Number.isFinite(car.x + car.y + car.speed)).toBe(true);
          if (!physics.isAiPitting(index)) maxOffset = Math.max(maxOffset, projectTrackNear(car.x, car.y, drivers[index].progress).distance);
        }
        if (physics.passingStates().some(state => state.phase !== 'FOLLOW')) actions++;
      }
      console.info('GP_PASSING_FIELD', JSON.stringify({ enabled, maxOffset, actions, controllerMs: cpuMs / samples,
        laps: drivers.map(d => d.lap), pitStops: drivers.map(d => d.pitStopIndex) }));
      expect(drivers.every(d => d.lap >= 2)).toBe(true);
      expect(drivers.every(d => d.speed > 25)).toBe(true);
      expect(maxOffset).toBeLessThan(25);
      expect(cpuMs / samples).toBeLessThan(50); // catastrophic guard, not FPS
      if (enabled) expect(actions).toBeGreaterThan(0);
    } finally { physics.world.free(); }
  }
}, 90_000);
it('reset clears a live maneuver and opting out retains the baseline', () => {
  const [driver] = createAiField();
  driver.progress = 0.04; driver.lap = 1; driver.pitPlan = [];
  const pose = sampleTrack(0.04 + 40 / TRACK_LENGTH), back = sampleTrack(0.04);
  const physics = new RapierRacePhysics(createVehicle(pose.x, pose.y, pose.heading), [driver], true);
  try {
    physics.setAiState(0, { ...createVehicle(back.x, back.y, back.heading), speed: 75 });
    physics.setPlayerState({ ...createVehicle(pose.x, pose.y, pose.heading), speed: 65 });
    physics.syncAiKinematics([driver], DT, 1);
    expect(physics.passingStates()[0].phase).toBe('COMMIT');
    physics.reset(createVehicle(pose.x, pose.y, pose.heading), [driver]);
    expect(physics.passingStates()[0].phase).toBe('FOLLOW');
    physics.syncAiKinematics([driver], DT, 1, false);
    expect(physics.passingStates()[0].rivalId).toBeUndefined();
  } finally { physics.world.free(); }
});

it('retains physical pit service and rejoin with GP passing enabled', () => {
  const [driver] = createAiField();
  driver.lap = driver.pitLap;
  driver.progress = pitEntryProgress() - 260 / TRACK_LENGTH;
  const remote = sampleTrack(0.5, 260), pose = sampleTrack(driver.progress, driver.laneOffset);
  const physics = new RapierRacePhysics(createVehicle(remote.x, remote.y, remote.heading), [driver], true);
  physics.setAiState(0, { ...createVehicle(pose.x, pose.y, pose.heading), speed: 88 });
  let entered = false, completed = false;
  try {
    for (let tick = 0; tick < 32 / DT; tick++) {
      physics.syncAiKinematics([driver], DT, 1, false); physics.step(DT);
      if (physics.isAiPitting(0)) {
        entered = true;
        expect(physics.passingStates()[0]?.phase ?? 'FOLLOW').toBe('FOLLOW');
      }
      if (entered && !physics.isAiPitting(0) && driver.pitStopIndex === 1) { completed = true; break; }
    }
    expect(entered).toBe(true); expect(completed).toBe(true);
    expect(driver.usedCompounds.has(driver.nextCompound)).toBe(true);
  } finally { physics.world.free(); }
}, 20_000);
