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
    if (Math.abs(gap) < raceScaleDistance(18) && lateral < 8.5 && Math.abs(gap) < alongsideGap) {
      alongside = other;
      alongsideGap = Math.abs(gap);
    }
  }

  const laneBlocked = ahead !== undefined
    && aheadGap < raceScaleDistance(70)
    && Math.abs(ahead.laneOffset - projection.laneOffset) < 5.8;
  const emergencyGap = laneBlocked && aheadGap < raceScaleDistance(20);
  const canAttack = laneBlocked
    && !emergencyGap
    && ahead !== undefined
    && aheadGap < raceScaleDistance(58)
    && driver.tire.wear < 0.94;
  const playerThreat = behind?.isPlayer === true && behindGap < raceScaleDistance(50);

  let battleState: BattleState = 'CLEAR';
  if (alongside) battleState = 'SIDE_BY_SIDE';
  else if (canAttack) battleState = 'ATTACK';
  else if (laneBlocked && aheadGap < raceScaleDistance(78)) battleState = 'FOLLOW';
  else if (playerThreat) battleState = 'DEFEND';

  const speed = vehicle.speed;
  const lookAheadMetres = raceScaleDistance(clamp(34 + speed * 0.44, 44, 92));
  const targetProgress = projection.progress + lookAheadMetres / TRACK_LENGTH;
  let targetLane = clamp(
    racingLineOffset(targetProgress, driver.tire.grip) + driver.preferredLane * 0.06,
    -AI_SAFE_LANE_LIMIT,
    AI_SAFE_LANE_LIMIT,
  );

  if (battleState === 'ATTACK' && ahead) {
    const side = stableSide(driver.id);
    const firstChoice = clamp(ahead.laneOffset + side * 6.1, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
    const alternate = clamp(ahead.laneOffset - side * 6.1, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
    targetLane = Math.abs(firstChoice - ahead.laneOffset) >= 4.8 ? firstChoice : alternate;
  } else if (battleState === 'SIDE_BY_SIDE' && alongside) {
    const side = projection.laneOffset >= alongside.laneOffset ? 1 : -1;
    targetLane = clamp(alongside.laneOffset + side * 5.7, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
  } else if (battleState === 'FOLLOW' && ahead) {
    targetLane = clamp(ahead.laneOffset + stableSide(driver.id) * 1.6, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
  } else if (battleState === 'DEFEND') {
    const inside = Math.abs(profile.signedTurn) > 0.035
      ? Math.sign(profile.signedTurn) * 4.8
      : stableSide(driver.id) * 3.4;
    targetLane = clamp(inside, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
  }

  if (projection.distance > TRACK_ROAD_HALF_WIDTH + 2.8) {
    targetLane = 0;
    battleState = 'CLEAR';
  }

  const target = sampleTrack(targetProgress, targetLane);
  const targetHeading = Math.atan2(target.y - vehicle.y, target.x - vehicle.x);
  const headingError = wrapAngle(targetHeading - vehicle.heading);
  const lateralError = clamp((targetLane - projection.laneOffset) / 8.5, -1, 1);
  const recoveryGain = projection.distance > TRACK_ROAD_HALF_WIDTH + 1.5 ? 0.78 : 0.42;
  // Miniature corners arrive faster and have tighter radii. Increase heading
  // authority rather than lowering the whole field's pace.
  const steer = clamp(headingError * 2.82 + lateralError * recoveryGain, -1, 1);

  const nextProfile = trackProfile(
    projection.progress + raceScaleDistance(clamp(42 + speed * 0.38, 52, 94)) / TRACK_LENGTH,
    driver.skill,
    driver.tire.grip,
  );

  const usableGrip = clamp((driver.tire.grip - 0.55) / 0.79, 0, 1);
  const skillPace = 1.08 + clamp(driver.skill - 1, -0.08, 0.24) * 0.92;
  const cornerDemand = Math.max(profile.severity, nextProfile.severity * 0.84);
  const cornerPaceFactor = 1.04 + profile.severity * usableGrip * 0.075;
  const predictionAllowance = 15 + cornerDemand * (8 + usableGrip * 20);
  const cornerExecution = 1 + cornerDemand * 0.048;
  let targetSpeed = Math.min(
    profile.targetSpeed * cornerPaceFactor,
    nextProfile.targetSpeed + predictionAllowance,
  ) * skillPace * cornerExecution;

  if (battleState === 'ATTACK' && profile.severity < 0.36) targetSpeed += 11;
  if (laneBlocked && ahead) {
    const desiredGap = raceScaleDistance(24);
    const buffer = raceScaleDistance(13);
    if (aheadGap < desiredGap + buffer) {
      const closingAllowance = clamp((aheadGap - desiredGap) * 0.72, -9, 8);
      targetSpeed = Math.min(targetSpeed, ahead.speed + closingAllowance);
    }
    if (aheadGap < raceScaleDistance(17)) targetSpeed = Math.min(targetSpeed, Math.max(30, ahead.speed - 6));
  }
  if (projection.distance > TRACK_ROAD_HALF_WIDTH + 2.8) targetSpeed = Math.min(targetSpeed, 58);
  if (projection.distance > TRACK_RUNOFF_HALF_WIDTH) targetSpeed = Math.min(targetSpeed, 40);
  targetSpeed = clamp(targetSpeed, 28, 132);

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
