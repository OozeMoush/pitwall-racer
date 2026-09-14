import { raceDistance, type BattleState, type DriverState, type RaceTrafficCar } from './RaceModel';
import { AI_SAFE_LANE_LIMIT, TRACK_ROAD_HALF_WIDTH, TRACK_RUNOFF_HALF_WIDTH } from './TrackLimitsModel';
import { projectTrackNear, sampleTrack, TRACK_LENGTH } from './TrackModel';
import { racingLineOffset, trackProfile } from './TrackProfile';
import type { VehicleState } from './VehicleModel';

export interface DynamicAiControl {
  throttle: number;
  brake: number;
  steer: number;
  targetSpeed: number;
  targetLane: number;
  battleState: BattleState;
}

const BATTLE_LANE_LIMIT = Math.min(AI_SAFE_LANE_LIMIT, 11.8);
const SAFE_SIDE_BY_SIDE_GAP = 6.4;
const AHEAD_SEARCH_LATERAL = 10.0;
const BLOCKING_LANE_WIDTH = 5.4;
const BRAKING_SAMPLES_METRES = [0, 22, 46, 74, 108, 148, 194] as const;

/**
 * Physical AI for the race weekend.
 *
 * These are professional single-seater drivers. A clean lap follows one stable
 * racing line with a forward braking envelope; traffic may create one decisive
 * passing move, but it must never turn the field into a scripted queue. All
 * traffic decisions use the physical Rapier positions rather than abstract
 * occupancy lanes.
 */
export function dynamicAiControl(
  driver: DriverState,
  vehicle: VehicleState,
  traffic: readonly RaceTrafficCar[],
): DynamicAiControl {
  const projection = projectTrackNear(vehicle.x, vehicle.y, driver.progress);
  const profile = trackProfile(projection.progress, driver.skill, driver.tire.grip);
  const battlePreview = trackProfile(
    projection.progress + 72 / TRACK_LENGTH,
    driver.skill,
    driver.tire.grip,
  );
  const battleSeverity = Math.max(profile.severity, battlePreview.severity * 0.92);
  const battleSafe = battleSeverity < 0.52 && projection.distance < TRACK_ROAD_HALF_WIDTH + 0.5;
  const driverDistance = raceDistance(driver.lap, projection.progress) * TRACK_LENGTH;

  let ahead: RaceTrafficCar | undefined;
  let aheadGap = Number.POSITIVE_INFINITY;
  let aheadLateral = Number.POSITIVE_INFINITY;
  let alongside: RaceTrafficCar | undefined;
  let alongsideGap = Number.POSITIVE_INFINITY;

  for (const other of traffic) {
    if (other.id === driver.id) continue;
    const otherDistance = raceDistance(other.lap, other.progress) * TRACK_LENGTH;
    const gap = otherDistance - driverDistance;
    const lateral = Math.abs(other.laneOffset - projection.laneOffset);

    // Keep tracking a pass target after the attacker has moved out of the
    // leader's exact lane. The previous narrow search forgot the target halfway
    // through a move, pulled the attacker back to the racing line, and rebuilt
    // the parade over and over.
    if (gap > 0 && lateral < AHEAD_SEARCH_LATERAL && gap < aheadGap) {
      ahead = other;
      aheadGap = gap;
      aheadLateral = lateral;
    }

    // Side-by-side racecraft applies to every car, not just the player. Once a
    // passing car has moved out of the leader's wake it must be allowed to stay
    // alongside and complete the move instead of being pulled back into line.
    if (battleSafe
      && Math.abs(gap) < 13.5
      && lateral >= 3.4
      && lateral < 11.8
      && Math.abs(gap) < alongsideGap) {
      alongside = other;
      alongsideGap = Math.abs(gap);
    }
  }

  const laneBlockedRange = 38;
  const attackRange = 36;
  const followRange = 44;
  const laneBlocked = ahead !== undefined
    && aheadGap < laneBlockedRange
    && aheadLateral < BLOCKING_LANE_WIDTH;
  const canAttack = battleSafe
    && ahead !== undefined
    && aheadGap < attackRange
    && aheadLateral < AHEAD_SEARCH_LATERAL
    && driver.tire.wear < 0.94;

  let battleState: BattleState = 'CLEAR';
  if (alongside) battleState = 'SIDE_BY_SIDE';
  else if (canAttack) battleState = 'ATTACK';
  else if (laneBlocked && aheadGap < followRange) battleState = 'FOLLOW';

  const speed = vehicle.speed;
  const technicalLookahead = 1 - clamp((profile.severity - 0.62) / 0.38, 0, 1) * 0.24;
  const lookAheadMetres = clamp(34 + speed * 0.52, 46, 94) * technicalLookahead;
  const targetProgress = projection.progress + lookAheadMetres / TRACK_LENGTH;
  const baseLane = clamp(
    racingLineOffset(targetProgress, driver.tire.grip) * 0.90 + driver.preferredLane * 0.02,
    -AI_SAFE_LANE_LIMIT,
    AI_SAFE_LANE_LIMIT,
  );

  let targetLane = approachLane(projection.laneOffset, baseLane, 1.8);

  if (battleState === 'ATTACK' && ahead) {
    const side = ahead.laneOffset > 1.2
      ? -1
      : ahead.laneOffset < -1.2
        ? 1
        : stableSide(driver.id);
    const passOffset = ahead.isPlayer === true ? 7.6 : 7.0;
    const firstChoice = clamp(ahead.laneOffset + side * passOffset, -BATTLE_LANE_LIMIT, BATTLE_LANE_LIMIT);
    const alternate = clamp(ahead.laneOffset - side * passOffset, -BATTLE_LANE_LIMIT, BATTLE_LANE_LIMIT);
    const desired = Math.abs(firstChoice - ahead.laneOffset) >= passOffset * 0.80 ? firstChoice : alternate;
    targetLane = approachLane(projection.laneOffset, desired, 3.2);
  } else if (battleState === 'SIDE_BY_SIDE' && alongside) {
    const currentSeparation = Math.abs(projection.laneOffset - alongside.laneOffset);
    if (currentSeparation >= SAFE_SIDE_BY_SIDE_GAP) {
      targetLane = clamp(projection.laneOffset, -BATTLE_LANE_LIMIT, BATTLE_LANE_LIMIT);
    } else {
      const side = projection.laneOffset >= alongside.laneOffset ? 1 : -1;
      const desired = clamp(
        alongside.laneOffset + side * SAFE_SIDE_BY_SIDE_GAP,
        -BATTLE_LANE_LIMIT,
        BATTLE_LANE_LIMIT,
      );
      targetLane = approachLane(projection.laneOffset, desired, 3.2);
    }
  } else if (battleState === 'FOLLOW') {
    targetLane = approachLane(projection.laneOffset, baseLane, 1.5);
  }

  const offRoad = projection.distance > TRACK_ROAD_HALF_WIDTH + 0.25;
  if (offRoad) {
    targetLane = 0;
    battleState = 'CLEAR';
  }

  const steeringProgress = offRoad
    ? projection.progress + 20 / TRACK_LENGTH
    : targetProgress;
  const target = sampleTrack(steeringProgress, targetLane);
  const targetHeading = Math.atan2(target.y - vehicle.y, target.x - vehicle.x);
  const headingError = wrapAngle(targetHeading - vehicle.heading);
  const lateralError = clamp((targetLane - projection.laneOffset) / 10.5, -1, 1);
  const recoveryGain = offRoad ? 1.32 : 0.36;
  const headingGain = offRoad ? 3.30 : 2.94;
  const yawDamping = offRoad ? 0.26 : 0.46;
  const steerCommand = headingError * headingGain
    + lateralError * recoveryGain
    - vehicle.yawRate * yawDamping;
  const steerLimit = offRoad ? 1 : 0.96;
  const steer = clamp(steerCommand, -steerLimit, steerLimit);

  const speedPlan = professionalSpeedTarget(
    projection.progress,
    driver.skill,
    driver.tire.grip,
  );
  let targetSpeed = speedPlan.targetSpeed;

  if (battleState === 'ATTACK' && profile.severity < 0.38) targetSpeed += 8;
  if (battleState === 'SIDE_BY_SIDE' && alongside && profile.severity < 0.42) {
    const performanceEdge = clamp((driver.skill * driver.tire.grip - alongside.performance) * 18, -2.5, 3.5);
    targetSpeed = Math.max(targetSpeed, alongside.speed + performanceEdge);
  }

  // Pace-match only while physically blocked. An attacker that has moved clear
  // laterally keeps its own target speed and can actually complete the pass.
  if (laneBlocked && ahead) {
    const desiredGap = 8.8;
    const buffer = 4.8;
    if (aheadGap < desiredGap + buffer) {
      const closingAllowance = clamp((aheadGap - desiredGap) * 0.82, -7, 9);
      targetSpeed = Math.min(targetSpeed, ahead.speed + closingAllowance);
    }
    if (aheadGap < 6.8) {
      targetSpeed = Math.min(targetSpeed, Math.max(28, ahead.speed - 2.5));
    }
  }

  if (projection.distance > TRACK_ROAD_HALF_WIDTH + 1.0) targetSpeed = Math.min(targetSpeed, 58);
  if (projection.distance >= TRACK_RUNOFF_HALF_WIDTH) targetSpeed = Math.min(targetSpeed, 36);
  targetSpeed = clamp(targetSpeed, 26, 136);

  const speedError = targetSpeed - speed;
  const brake = speedError < -1.7
    ? clamp((-speedError - 0.5) / 10.5, 0.16, 1)
    : 0;
  const throttle = brake > 0.08
    ? 0
    : speedError > 3.0
      ? 1
      : speedError > 0.25
        ? clamp(0.48 + speedError / 8, 0.48, 1)
        : 0.20;

  return { throttle, brake, steer, targetSpeed, targetLane, battleState };
}

/**
 * Forward braking envelope for a qualifying-quality lap. For every meaningful
 * point ahead, calculate the maximum speed from which the car can still brake
 * to that corner's target. The lowest allowance wins. Skill changes execution
 * by small amounts; it must never create one super-powered driver.
 */
function professionalSpeedTarget(
  progress: number,
  skill: number,
  grip: number,
): { targetSpeed: number; cornerDemand: number } {
  const usableGrip = clamp((grip - 0.55) / 0.79, 0, 1);
  const pace = 1.130 + clamp(skill - 1.127, -0.12, 0.14) * 0.28;
  const brakingDecel = 35.5 + usableGrip * 5.0;
  let targetSpeed = 136;
  let cornerDemand = 0;

  for (const distance of BRAKING_SAMPLES_METRES) {
    const sample = trackProfile(progress + distance / TRACK_LENGTH, skill, grip);
    cornerDemand = Math.max(cornerDemand, sample.severity);
    const cornerPace = 1.015 + sample.severity * usableGrip * 0.055;
    const desiredAtSample = clamp(sample.targetSpeed * cornerPace * pace, 26, 132);
    const allowedNow = distance <= 0
      ? desiredAtSample
      : Math.sqrt(desiredAtSample * desiredAtSample + 2 * brakingDecel * distance);
    targetSpeed = Math.min(targetSpeed, allowedNow);
  }

  return { targetSpeed, cornerDemand };
}

function approachLane(current: number, desired: number, maximumDelta: number): number {
  return clamp(desired, current - maximumDelta, current + maximumDelta);
}

function stableSide(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return hash % 2 === 0 ? 1 : -1;
}

function wrapAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
