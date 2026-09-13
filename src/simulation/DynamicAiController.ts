import { raceDistance, type BattleState, type DriverState, type RaceTrafficCar } from './RaceModel';
import { AI_SAFE_LANE_LIMIT, TRACK_ROAD_HALF_WIDTH, TRACK_RUNOFF_HALF_WIDTH } from './TrackLimitsModel';
import { projectTrack, raceScaleDistance, sampleTrack, TRACK_LENGTH } from './TrackModel';
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

export function dynamicAiControl(
  driver: DriverState,
  vehicle: VehicleState,
  traffic: readonly RaceTrafficCar[],
): DynamicAiControl {
  const projection = projectTrack(vehicle.x, vehicle.y);
  const profile = trackProfile(projection.progress, driver.skill, driver.tire.grip);
  const driverDistance = raceDistance(driver.lap, projection.progress) * TRACK_LENGTH;

  let ahead: RaceTrafficCar | undefined;
  let aheadGap = Number.POSITIVE_INFINITY;
  let behind: RaceTrafficCar | undefined;
  let behindGap = Number.POSITIVE_INFINITY;
  let alongside: RaceTrafficCar | undefined;
  let alongsideGap = Number.POSITIVE_INFINITY;

  for (const other of traffic) {
    if (other.id === driver.id) continue;
    const otherDistance = raceDistance(other.lap, other.progress) * TRACK_LENGTH;
    const gap = otherDistance - driverDistance;
    const lateral = Math.abs(other.laneOffset - projection.laneOffset);

    if (gap > 0 && gap < aheadGap) {
      ahead = other;
      aheadGap = gap;
    }
    if (gap < 0 && -gap < behindGap) {
      behind = other;
      behindGap = -gap;
    }
    if (Math.abs(gap) < raceScaleDistance(20) && lateral < 13.5 && Math.abs(gap) < alongsideGap) {
      alongside = other;
      alongsideGap = Math.abs(gap);
    }
  }

  const laneBlocked = ahead !== undefined
    && aheadGap < raceScaleDistance(80)
    && Math.abs(ahead.laneOffset - projection.laneOffset) < 7.5;
  const emergencyGap = laneBlocked && aheadGap < raceScaleDistance(20);
  const canAttack = laneBlocked
    && !emergencyGap
    && ahead !== undefined
    && aheadGap < raceScaleDistance(70)
    && driver.tire.wear < 0.94;
  const playerThreat = behind?.isPlayer === true && behindGap < raceScaleDistance(55);

  let battleState: BattleState = 'CLEAR';
  if (alongside) battleState = 'SIDE_BY_SIDE';
  else if (canAttack) battleState = 'ATTACK';
  else if (laneBlocked && aheadGap < raceScaleDistance(86)) battleState = 'FOLLOW';
  else if (playerThreat) battleState = 'DEFEND';

  const speed = vehicle.speed;
  const lookAheadMetres = raceScaleDistance(clamp(42 + speed * 0.46, 52, 102));
  const targetProgress = projection.progress + lookAheadMetres / TRACK_LENGTH;
  const baseLane = clamp(
    racingLineOffset(targetProgress, driver.tire.grip) + driver.preferredLane * 0.045,
    -AI_SAFE_LANE_LIMIT,
    AI_SAFE_LANE_LIMIT,
  );

  // Do not teleport the requested line from one side of the circuit to the
  // other. The physical car can only move a few metres laterally at a time;
  // bounding the lane request removes the visible steering snake while keeping
  // real outside-apex-outside placement.
  let targetLane = approachLane(projection.laneOffset, baseLane, 3.4);

  if (battleState === 'ATTACK' && ahead) {
    const side = stableSide(driver.id);
    const firstChoice = clamp(ahead.laneOffset + side * 5.6, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
    const alternate = clamp(ahead.laneOffset - side * 5.6, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
    const desired = Math.abs(firstChoice - ahead.laneOffset) >= 4.8 ? firstChoice : alternate;
    targetLane = approachLane(projection.laneOffset, desired, 4.0);
  } else if (battleState === 'SIDE_BY_SIDE' && alongside) {
    const side = projection.laneOffset >= alongside.laneOffset ? 1 : -1;
    const desired = clamp(alongside.laneOffset + side * 5.8, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
    targetLane = approachLane(projection.laneOffset, desired, 4.4);
  } else if (battleState === 'FOLLOW' && ahead) {
    const desired = clamp(ahead.laneOffset + stableSide(driver.id) * 1.2, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
    targetLane = approachLane(projection.laneOffset, desired, 2.4);
  } else if (battleState === 'DEFEND') {
    const inside = Math.abs(profile.signedTurn) > 0.035
      ? Math.sign(profile.signedTurn) * 4.4
      : stableSide(driver.id) * 3.2;
    targetLane = approachLane(projection.laneOffset, clamp(inside, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT), 3.2);
  }

  const offRoad = projection.distance > TRACK_ROAD_HALF_WIDTH + 1.2;
  if (offRoad) {
    targetLane = approachLane(projection.laneOffset, 0, 7.0);
    battleState = 'CLEAR';
  }

  const target = sampleTrack(targetProgress, targetLane);
  const targetHeading = Math.atan2(target.y - vehicle.y, target.x - vehicle.x);
  const headingError = wrapAngle(targetHeading - vehicle.heading);
  const lateralError = clamp((targetLane - projection.laneOffset) / 10.5, -1, 1);
  const recoveryGain = offRoad ? 0.95 : 0.30;
  const steerCommand = headingError * 2.38
    + lateralError * recoveryGain
    - vehicle.yawRate * 0.42;
  const steerLimit = offRoad ? 1 : 0.92;
  const steer = clamp(steerCommand, -steerLimit, steerLimit);

  const nextProfile = trackProfile(
    projection.progress + raceScaleDistance(clamp(46 + speed * 0.40, 58, 102)) / TRACK_LENGTH,
    driver.skill,
    driver.tire.grip,
  );

  const usableGrip = clamp((driver.tire.grip - 0.55) / 0.79, 0, 1);
  const skillPace = 1.07 + clamp(driver.skill - 1, -0.08, 0.24) * 0.90;
  const cornerDemand = Math.max(profile.severity, nextProfile.severity * 0.84);
  const cornerPaceFactor = 1.035 + profile.severity * usableGrip * 0.060;
  const predictionAllowance = 12 + cornerDemand * (6 + usableGrip * 15);
  const cornerExecution = 1 + cornerDemand * 0.025;
  let targetSpeed = Math.min(
    profile.targetSpeed * cornerPaceFactor,
    nextProfile.targetSpeed + predictionAllowance,
  ) * skillPace * cornerExecution;

  // The old miniature tune tried to recover pace by overdriving the tightest
  // corners. A clean 95% corner is faster than a 105% corner followed by grass.
  if (cornerDemand > 0.78) targetSpeed *= 0.96;
  if (battleState === 'ATTACK' && profile.severity < 0.36) targetSpeed += 7;
  if (laneBlocked && ahead) {
    const desiredGap = raceScaleDistance(24);
    const buffer = raceScaleDistance(13);
    if (aheadGap < desiredGap + buffer) {
      const closingAllowance = clamp((aheadGap - desiredGap) * 0.72, -9, 8);
      targetSpeed = Math.min(targetSpeed, ahead.speed + closingAllowance);
    }
    if (aheadGap < raceScaleDistance(17)) targetSpeed = Math.min(targetSpeed, Math.max(28, ahead.speed - 7));
  }
  if (projection.distance > TRACK_ROAD_HALF_WIDTH + 1.2) targetSpeed = Math.min(targetSpeed, 46);
  if (projection.distance >= TRACK_RUNOFF_HALF_WIDTH) targetSpeed = Math.min(targetSpeed, 30);
  targetSpeed = clamp(targetSpeed, 26, 132);

  const speedError = targetSpeed - speed;
  const brake = speedError < -2.2
    ? clamp((-speedError - 0.5) / 11.5, 0.18, 1)
    : 0;
  const throttle = brake > 0.08
    ? 0
    : speedError > 4
      ? 1
      : speedError > 0.4
        ? clamp(0.48 + speedError / 9, 0.48, 1)
        : 0.20;

  return { throttle, brake, steer, targetSpeed, targetLane, battleState };
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
