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
const SAFE_SIDE_BY_SIDE_GAP = 7.0;
const TRAFFIC_LANE_WIDTH = 8.0;
const BRAKING_SAMPLES_METRES = [0, 22, 46, 74, 108, 148, 194] as const;

/**
 * Physical AI for the race weekend.
 *
 * These are supposed to be professional single-seater drivers, so the default
 * behaviour is deliberately boring in the good sense: follow one repeatable
 * racing line, look far enough ahead to brake before the corner, hit the apex,
 * unwind the steering and only leave that line for an actual pass or the
 * player. The miniature circuit is shorter, but 300 km/h still needs real
 * braking distance; steering/braking lookahead therefore uses physical metres
 * and is not multiplied by the miniature layout scale.
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
  const battleSafe = battleSeverity < 0.48 && projection.distance < TRACK_ROAD_HALF_WIDTH + 0.5;
  const driverDistance = raceDistance(driver.lap, projection.progress) * TRACK_LENGTH;

  let ahead: RaceTrafficCar | undefined;
  let aheadGap = Number.POSITIVE_INFINITY;
  let alongside: RaceTrafficCar | undefined;
  let alongsideGap = Number.POSITIVE_INFINITY;

  for (const other of traffic) {
    if (other.id === driver.id) continue;
    const otherDistance = raceDistance(other.lap, other.progress) * TRACK_LENGTH;
    const gap = otherDistance - driverDistance;
    const lateral = Math.abs(other.laneOffset - projection.laneOffset);

    if (gap > 0 && lateral < TRAFFIC_LANE_WIDTH && gap < aheadGap) {
      ahead = other;
      aheadGap = gap;
    }

    // AI cars keep their own racing line rather than mirroring every neighbour.
    // Only the player requires an explicit hard side-by-side avoidance move.
    if (other.isPlayer === true
      && battleSafe
      && Math.abs(gap) < 13
      && lateral < 13.5
      && Math.abs(gap) < alongsideGap) {
      alongside = other;
      alongsideGap = Math.abs(gap);
    }
  }

  const laneBlockedRange = 34;
  const attackRange = 28;
  const followRange = 42;
  const laneBlocked = ahead !== undefined && aheadGap < laneBlockedRange;
  const canAttack = laneBlocked
    && battleSafe
    && ahead !== undefined
    && aheadGap < attackRange
    && driver.tire.wear < 0.94;

  let battleState: BattleState = 'CLEAR';
  if (alongside) battleState = 'SIDE_BY_SIDE';
  else if (canAttack) battleState = 'ATTACK';
  else if (laneBlocked && aheadGap < followRange) battleState = 'FOLLOW';

  const speed = vehicle.speed;
  const technicalLookahead = 1 - clamp((profile.severity - 0.62) / 0.38, 0, 1) * 0.30;
  const lookAheadMetres = clamp(34 + speed * 0.52, 46, 92) * technicalLookahead;
  const targetProgress = projection.progress + lookAheadMetres / TRACK_LENGTH;
  const baseLane = clamp(
    racingLineOffset(targetProgress, driver.tire.grip) * 0.88 + driver.preferredLane * 0.025,
    -AI_SAFE_LANE_LIMIT,
    AI_SAFE_LANE_LIMIT,
  );

  // No weaving on a clear lap. The requested line moves only a little at a
  // time; the steering controller then converges to that stable target.
  let targetLane = approachLane(projection.laneOffset, baseLane, 1.7);

  if (battleState === 'ATTACK' && ahead) {
    const side = stableSide(driver.id);
    const passOffset = ahead.isPlayer === true ? 5.8 : 4.2;
    const firstChoice = clamp(ahead.laneOffset + side * passOffset, -BATTLE_LANE_LIMIT, BATTLE_LANE_LIMIT);
    const alternate = clamp(ahead.laneOffset - side * passOffset, -BATTLE_LANE_LIMIT, BATTLE_LANE_LIMIT);
    const desired = Math.abs(firstChoice - ahead.laneOffset) >= passOffset * 0.82 ? firstChoice : alternate;
    targetLane = approachLane(projection.laneOffset, desired, ahead.isPlayer === true ? 3.6 : 2.8);
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
      targetLane = approachLane(projection.laneOffset, desired, 3.0);
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
  const recoveryGain = offRoad ? 1.32 : 0.34;
  const headingGain = offRoad ? 3.30 : 2.88;
  const yawDamping = offRoad ? 0.26 : 0.48;
  const steerCommand = headingError * headingGain
    + lateralError * recoveryGain
    - vehicle.yawRate * yawDamping;
  const steerLimit = offRoad ? 1 : 0.94;
  const steer = clamp(steerCommand, -steerLimit, steerLimit);

  const speedPlan = professionalSpeedTarget(
    projection.progress,
    driver.skill,
    driver.tire.grip,
  );
  let targetSpeed = speedPlan.targetSpeed;

  if (battleState === 'ATTACK' && profile.severity < 0.34) targetSpeed += 7;

  if (laneBlocked && ahead) {
    const desiredGap = 10.5;
    const buffer = 6.0;
    if (aheadGap < desiredGap + buffer) {
      const closingAllowance = clamp((aheadGap - desiredGap) * 0.70, -8, 8);
      targetSpeed = Math.min(targetSpeed, ahead.speed + closingAllowance);
    }
    if (aheadGap < 8.5) {
      targetSpeed = Math.min(targetSpeed, Math.max(28, ahead.speed - 4));
    }
  }

  if (projection.distance > TRACK_ROAD_HALF_WIDTH + 1.0) targetSpeed = Math.min(targetSpeed, 58);
  if (projection.distance >= TRACK_RUNOFF_HALF_WIDTH) targetSpeed = Math.min(targetSpeed, 36);
  targetSpeed = clamp(targetSpeed, 26, 132);

  const speedError = targetSpeed - speed;
  const brake = speedError < -1.4
    ? clamp((-speedError - 0.4) / 9.5, 0.18, 1)
    : 0;
  const throttle = brake > 0.08
    ? 0
    : speedError > 3.2
      ? 1
      : speedError > 0.35
        ? clamp(0.46 + speedError / 8, 0.46, 1)
        : 0.18;

  return { throttle, brake, steer, targetSpeed, targetLane, battleState };
}

/**
 * Backwards-looking braking envelope expressed as a forward scan. For every
 * meaningful point ahead, calculate the maximum speed from which the car can
 * still brake to that corner's target. The lowest allowance wins. This is what
 * stops a nominally fast AI from discovering the wall before the brake pedal.
 */
function professionalSpeedTarget(
  progress: number,
  skill: number,
  grip: number,
): { targetSpeed: number; cornerDemand: number } {
  const usableGrip = clamp((grip - 0.55) / 0.79, 0, 1);
  const pace = 1.015 + clamp(skill - 1.10, -0.12, 0.14) * 0.42;
  const brakingDecel = 27.5 + usableGrip * 5.5;
  let targetSpeed = 132;
  let cornerDemand = 0;

  for (const distance of BRAKING_SAMPLES_METRES) {
    const sample = trackProfile(progress + distance / TRACK_LENGTH, skill, grip);
    cornerDemand = Math.max(cornerDemand, sample.severity);
    const cornerPace = 1.01 + sample.severity * usableGrip * 0.045;
    const desiredAtSample = clamp(sample.targetSpeed * cornerPace * pace, 26, 128);
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
