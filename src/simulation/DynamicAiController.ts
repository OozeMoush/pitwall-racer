import { raceDistance, type BattleState, type DriverState, type RaceTrafficCar } from './RaceModel';
import { AI_SAFE_LANE_LIMIT, TRACK_ROAD_HALF_WIDTH, TRACK_RUNOFF_HALF_WIDTH } from './TrackLimitsModel';
import { projectTrack, sampleTrack, TRACK_LENGTH } from './TrackModel';
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
    if (Math.abs(gap) < 15 && lateral < 11 && Math.abs(gap) < alongsideGap) {
      alongside = other;
      alongsideGap = Math.abs(gap);
    }
  }

  // On the old 56 m road almost every car was considered to be in the same
  // lane. With a circuit that is actually narrow, distinguish a blocked racing
  // line from a car that is already offset enough to pass.
  const laneBlocked = ahead !== undefined
    && aheadGap < 62
    && Math.abs(ahead.laneOffset - projection.laneOffset) < 7.5;
  const emergencyGap = laneBlocked && aheadGap < 16;
  const canAttack = laneBlocked
    && !emergencyGap
    && ahead !== undefined
    && aheadGap < 50
    && driver.tire.wear < 0.94;
  const playerThreat = behind?.isPlayer === true && behindGap < 42;

  let battleState: BattleState = 'CLEAR';
  if (alongside) battleState = 'SIDE_BY_SIDE';
  else if (canAttack) battleState = 'ATTACK';
  else if (laneBlocked && aheadGap < 70) battleState = 'FOLLOW';
  else if (playerThreat) battleState = 'DEFEND';

  const speed = vehicle.speed;
  const lookAheadMetres = clamp(34 + speed * 0.44, 44, 92);
  const targetProgress = projection.progress + lookAheadMetres / TRACK_LENGTH;
  let targetLane = clamp(
    racingLineOffset(targetProgress, driver.tire.grip) + driver.preferredLane * 0.08,
    -AI_SAFE_LANE_LIMIT,
    AI_SAFE_LANE_LIMIT,
  );

  if (battleState === 'ATTACK' && ahead) {
    const side = stableSide(driver.id);
    const firstChoice = clamp(ahead.laneOffset + side * 8.2, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
    const alternate = clamp(ahead.laneOffset - side * 8.2, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
    targetLane = Math.abs(firstChoice - ahead.laneOffset) >= 6.2 ? firstChoice : alternate;
  } else if (battleState === 'SIDE_BY_SIDE' && alongside) {
    const side = projection.laneOffset >= alongside.laneOffset ? 1 : -1;
    targetLane = clamp(alongside.laneOffset + side * 7.6, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
  } else if (battleState === 'FOLLOW' && ahead) {
    targetLane = clamp(ahead.laneOffset + stableSide(driver.id) * 2.2, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
  } else if (battleState === 'DEFEND') {
    const inside = Math.abs(profile.signedTurn) > 0.035
      ? Math.sign(profile.signedTurn) * 6.5
      : stableSide(driver.id) * 4.5;
    targetLane = clamp(inside, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
  }

  if (projection.distance > TRACK_ROAD_HALF_WIDTH + 3.5) {
    targetLane = 0;
    battleState = 'CLEAR';
  }

  const target = sampleTrack(targetProgress, targetLane);
  const targetHeading = Math.atan2(target.y - vehicle.y, target.x - vehicle.x);
  const headingError = wrapAngle(targetHeading - vehicle.heading);
  const lateralError = clamp((targetLane - projection.laneOffset) / 11, -1, 1);
  const recoveryGain = projection.distance > TRACK_ROAD_HALF_WIDTH + 2 ? 0.72 : 0.38;
  const steer = clamp(headingError * 2.42 + lateralError * recoveryGain, -1, 1);

  const nextProfile = trackProfile(
    projection.progress + clamp(42 + speed * 0.38, 52, 94) / TRACK_LENGTH,
    driver.skill,
    driver.tire.grip,
  );

  const usableGrip = clamp((driver.tire.grip - 0.55) / 0.79, 0, 1);
  const skillPace = 1.08 + clamp(driver.skill - 1, -0.08, 0.24) * 0.92;
  const cornerDemand = Math.max(profile.severity, nextProfile.severity * 0.84);
  const cornerPaceFactor = 1.04 + profile.severity * usableGrip * 0.075;
  const predictionAllowance = 15 + cornerDemand * (8 + usableGrip * 20);
  let targetSpeed = Math.min(
    profile.targetSpeed * cornerPaceFactor,
    nextProfile.targetSpeed + predictionAllowance,
  ) * skillPace;

  if (battleState === 'ATTACK' && profile.severity < 0.36) targetSpeed += 11;
  if (laneBlocked && ahead) {
    const desiredGap = 20;
    if (aheadGap < desiredGap + 11) {
      const closingAllowance = clamp((aheadGap - desiredGap) * 0.40, -9, 8);
      targetSpeed = Math.min(targetSpeed, ahead.speed + closingAllowance);
    }
    if (aheadGap < 14) targetSpeed = Math.min(targetSpeed, Math.max(30, ahead.speed - 6));
  }
  if (projection.distance > TRACK_ROAD_HALF_WIDTH + 3.5) targetSpeed = Math.min(targetSpeed, 58);
  if (projection.distance > TRACK_RUNOFF_HALF_WIDTH) targetSpeed = Math.min(targetSpeed, 40);
  targetSpeed = clamp(targetSpeed, 28, 132);

  // Carry speed deeper into the braking zone, then brake harder. The previous
  // controller started trimming speed early and made every AI line look timid.
  const speedError = targetSpeed - speed;
  const brake = speedError < -2.7
    ? clamp((-speedError - 0.8) / 12.5, 0.16, 1)
    : 0;
  const throttle = brake > 0.08
    ? 0
    : speedError > 4
      ? 1
      : speedError > 0.4
        ? clamp(0.50 + speedError / 9, 0.50, 1)
        : 0.22;

  return { throttle, brake, steer, targetSpeed, targetLane, battleState };
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
