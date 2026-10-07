import { dynamicAiControl } from '../DynamicAiController';
import { CAR_COLLIDER_HALF_LENGTH, CAR_COLLIDER_HALF_WIDTH, RapierRacePhysics } from '../RapierRacePhysics';
import { createAiField, type RaceTrafficCar } from '../RaceModel';
import { activeReferenceTarget } from '../RacingLineRuntime';
import { surfaceEffect } from '../SurfaceModel';
import { trackAiSafeLaneLimit, trackRoadHalfWidth } from '../TrackLimitsModel';
import { sampleTrack, projectTrackNear, TRACK_LENGTH } from '../TrackModel';
import { signedHeadingDelta } from '../TrackProfile';
import { createVehicle } from '../VehicleModel';
import { PairPassing, type PassingInput } from './PairPassing';
import { CorridorPassing } from './CorridorPassing';


const DT = 1 / 120;
export function runPair(experiment: boolean | 'corridor', scenario: 'slower' | 'defends' | 'equal' | 'late', seconds = 12) {
  const ego = { ...createAiField()[1], lap: 1, progress: 0.04, laneOffset: 0, pitPlan: [] };
  const rival = { ...createAiField()[1], id: 'controlled-rival', lap: 1,
    progress: ego.progress + 40 / TRACK_LENGTH, laneOffset: 0, pitPlan: [] };
  const pose = sampleTrack(ego.progress);
  const opponentPose = sampleTrack(rival.progress);
  const physics = new RapierRacePhysics(createVehicle(opponentPose.x, opponentPose.y, opponentPose.heading), [ego]);
  physics.setPlayerState({ ...createVehicle(opponentPose.x, opponentPose.y, opponentPose.heading), speed: 65 });
  physics.setAiState(0, { ...createVehicle(pose.x, pose.y, pose.heading), speed: 75 });
  const policy = new PairPassing();
  const corridor = new CorridorPassing();
  const metrics = { samples: 0, contactEpisodes: 0, contactSeconds: 0, offroadSeconds: 0,
    stallSeconds: 0, passes: 0, returns: 0, aborts: 0, controllerMs: 0, distance: 0,
    maxLaneRate: 0, maxPhysicalLaneRate: 0, minSeparation: Infinity, returnAt: [] as number[], brakingSeconds: 0, turningSeconds: 0, phases: [] as string[], contacts: [] as { time: number; phase: string; gap: number; lane: number; opponentLane: number }[] };
  let contactBefore = false;
  let passed = false;
  let lastPhase = 'FOLLOW';
  let previousLane: number | undefined;
  let maxController = 0;
  let controllerSamples = 0;
  let previousPhysicalLane: number | undefined;
  try {
    for (let tick = 0; tick < seconds / DT; tick++) {
      const car = physics.aiStates()[0];
      const other = physics.playerState();
      const road = projectTrackNear(car.x, car.y, ego.progress);
      const rivalRoad = projectTrackNear(other.x, other.y, rival.progress);
      for (const [driver, projection, vehicle] of [[ego, road, car], [rival, rivalRoad, other]] as const) {
        if (driver.progress > 0.88 && projection.progress < 0.12) driver.lap++;
        driver.progress = projection.progress;
        driver.laneOffset = projection.laneOffset;
        driver.speed = vehicle.speed;
      }
      if (previousPhysicalLane !== undefined) metrics.maxPhysicalLaneRate = Math.max(
        metrics.maxPhysicalLaneRate, Math.abs(road.laneOffset - previousPhysicalLane) / DT);
      previousPhysicalLane = road.laneOffset;
      metrics.minSeparation = Math.min(metrics.minSeparation, Math.hypot(car.x - other.x, car.y - other.y));
      const traffic: RaceTrafficCar[] = [ego, rival].map(d => ({ ...d, performance: 1 }));
      const started = performance.now();
      const base = dynamicAiControl(ego, car, traffic);
      let steer = base.steer;
      let speed = base.targetSpeed;
      let override = false;
      if (experiment) {
        const reference = activeReferenceTarget('pitwall-gp', ego.progress, ego.tire.grip);
        const gap = ((rival.lap - ego.lap) + rival.progress - ego.progress) * TRACK_LENGTH;
        const input: PassingInput = { dt: DT, gap, speed: car.speed, opponentSpeed: other.speed,
          lane: road.laneOffset, opponentLane: rivalRoad.laneOffset, referenceLane: reference.laneOffset,
          safeLane: Math.min(...[0, 30, 60, 90, 120].map(m => trackAiSafeLaneLimit(ego.progress + m / TRACK_LENGTH))),
          straight: Math.abs(signedHeadingDelta(ego.progress, ego.progress + 120 / TRACK_LENGTH)) < 0.12 };
        const next = experiment === 'corridor' ? corridor.step(input, car, ego.progress, ego.tire.grip) : undefined;
        const plan = next ?? policy.step(input);
        if (plan.phase !== 'FOLLOW') {
          override = true;
          const lookahead = Math.max(25, car.speed * 0.5);
          const target = sampleTrack(ego.progress + lookahead / TRACK_LENGTH, plan.lane);
          const heading = wrap(Math.atan2(target.y - car.y, target.x - car.x) - car.heading);
          steer = clamp(heading * 2.5 - car.yawRate * 0.4, -0.98, 0.98);
          speed = Math.min(reference.targetSpeed, plan.speedCap);
          if (next) { steer = next.steer; speed = next.speed; }
        }
        if (plan.phase !== lastPhase) {
          metrics.phases.push(plan.phase);
          if (plan.phase === 'ABORT') metrics.aborts++;
          if (plan.phase === 'FOLLOW') { metrics.returns++; metrics.returnAt.push(tick * DT); }
          lastPhase = plan.phase;
        }
        if (previousLane !== undefined) {
          metrics.maxLaneRate = Math.max(metrics.maxLaneRate, Math.abs(plan.lane - previousLane) / DT);
        }
        previousLane = plan.lane;
        if (gap < -18 && !passed) { metrics.passes++; passed = true; }
      } else if (((ego.lap - rival.lap) + ego.progress - rival.progress) * TRACK_LENGTH > 18 && !passed) {
        metrics.passes++; passed = true;
      }
      const cost = performance.now() - started;
      if (tick >= 120) { maxController += cost; controllerSamples++; }
      const rivalControl = dynamicAiControl(rival, other, []);
      // Scripted rival: normal AUTO steering, bounded pace; defensive case holds
      // the initially selected passing side on the straight, then resumes AUTO.
      let rivalSteer = rivalControl.steer;
      if ((scenario === 'defends' && tick < 360) || (scenario === 'late' && tick >= 240 && tick < 600)) {
        const target = sampleTrack(rival.progress + Math.max(25, other.speed * 0.5) / TRACK_LENGTH, -6);
        rivalSteer = clamp(wrap(Math.atan2(target.y - other.y, target.x - other.x) - other.heading) * 2.5 - other.yawRate * 0.4, -0.98, 0.98);
      }
      const rivalSpeed = Math.min(rivalControl.targetSpeed, scenario === 'equal' ? 100 : 65);
      const drive = (targetSpeed: number, actual: number, steering: number, distance: number) => {
        const surface = surfaceEffect(distance);
        return { throttle: actual < targetSpeed ? 1 : 0, brake: clamp((actual - targetSpeed) / 8, 0, 1),
          steer: steering, tireGrip: ego.tire.grip, surfaceGrip: surface.gripMultiplier,
          powerBoost: 0.22, powerMultiplier: surface.powerMultiplier, rollingResistance: surface.rollingResistance };
      };
      const egoInput = drive(speed, car.speed, steer, road.distance);
      if (!override) { egoInput.throttle = base.throttle; egoInput.brake = base.brake; }
      if (egoInput.brake > 0.1) metrics.brakingSeconds += DT;
      if (Math.abs(car.yawRate) > 0.15) metrics.turningSeconds += DT;
      physics.driveAi(0, egoInput, DT);
      const rivalInput = drive(rivalSpeed, other.speed, rivalSteer, rivalRoad.distance);
      rivalInput.brake = Math.max(rivalInput.brake, rivalControl.brake);
      rivalInput.throttle = rivalInput.brake > 0.06 ? 0 : rivalControl.throttle;
      physics.drivePlayer(rivalInput, DT);
      physics.step(DT);
      let contact = false;
      physics.world.forEachCollider(collider => {
        if (!collider.parent()?.isDynamic()) return;
        physics.world.contactPairsWith(collider, otherCollider => {
          physics.world.contactPair(collider, otherCollider, manifold => {
            for (let index = 0; index < manifold.numContacts(); index++) {
              if (manifold.contactDist(index) <= 0) contact = true;
            }
          });
        });
      });
      if (contact && !contactBefore) {
        metrics.contactEpisodes++;
        metrics.contacts.push({ time: tick * DT, phase: lastPhase,
          gap: ((rival.lap - ego.lap) + rival.progress - ego.progress) * TRACK_LENGTH,
          lane: road.laneOffset, opponentLane: rivalRoad.laneOffset });
      }
      if (contact) metrics.contactSeconds += DT;
      contactBefore = contact;
      const outside = (heading: number, progress: number, distance: number) => {
        const angle = heading - sampleTrack(progress).heading;
        const extent = Math.abs(Math.sin(angle)) * CAR_COLLIDER_HALF_LENGTH
          + Math.abs(Math.cos(angle)) * CAR_COLLIDER_HALF_WIDTH;
        return distance + extent > trackRoadHalfWidth(progress);
      };
      if (outside(car.heading, ego.progress, road.distance)
        || outside(other.heading, rival.progress, rivalRoad.distance)) metrics.offroadSeconds += DT;
      if (car.speed < 2 || other.speed < 2) metrics.stallSeconds += DT;
      metrics.distance += car.speed * DT;
      metrics.samples++;
    }
    metrics.controllerMs = maxController / controllerSamples;
    return metrics;
  } finally { physics.world.free(); }
}
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function wrap(v: number) { return Math.atan2(Math.sin(v), Math.cos(v)); }
