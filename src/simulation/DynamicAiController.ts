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

const BATTLE_LANE_LIMIT = Math.min(AI_SAFE_LANE_LIMIT, 11.8);
const SAFE_SIDE_BY_SIDE_GAP = 6.2;

export function dynamicAiControl(
  driver: DriverState,
  vehicle: VehicleState,
  traffic: readonly RaceTrafficCar[],
): DynamicAiControl {
  const projection = projectTrack(vehicle.x, vehicle.y);
  const profile = trackProfile(projection.progress, driver.skill, driver.tire.grip);
  const battlePreview = trackProfile(
    projection.progress + raceScaleDistance(105) / TRACK_LENGTH,
    driver.skill,
    driver.tire.grip,
  );
  const battleSeverity = Math.max(profile.severity, battlePreview.severity * 0.92);
  const battleSafe = battleSeverity < 0.48 && projection.distance < TRACK_ROAD_HALF_WIDTH + 0.5;
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
    && Math.abs(ahead.laneOffset - projection.laneOffset) < 7.0;
  const canAttack = laneBlocked
    && battleSafe
    && ahead !== undefined
    && aheadGap < raceScaleDistance(70)
    && driver.tire.wear < 0.94;
  const playerThreat = battleSafe
    && behind?.isPlayer === true
    && behindGap < raceScaleDistance(55);

  let battleState: BattleState = 'CLEAR';
  if (alongside) battleState = 'SIDE_BY_SIDE';
  else if (canAttack) battleState = 'ATTACK';
  else if (laneBlocked && aheadGap < raceScaleDistance(86)) battleState = 'FOLLOW';
  else if (playerThreat) battleState = 'DEFEND';

  const speed = vehicle.speed;
  const lookAheadMetres = raceScaleDistance(clamp(44 + speed * 0.46, 54, 104));
  const targetProgress = projection.progress + lookAheadMetres / TRACK_LENGTH;
  const baseLane = clamp(
    racingLineOffset(targetProgress, driver.tire.grip) + driver.preferredLane * 0.04,
    -AI_SAFE_LANE_LIMIT,
    AI_SAFE_LANE_LIMIT,
  );

  // Keep normal corner placement gradual. A deliberate pass is allowed one
  // clean move only when the geometry ahead is mild enough to support it.
  let targetLane = approachLane(projection.laneOffset, baseLane, 2.8);

  if (battleState === 'ATTACK' && ahead) {
    const side = stableSide(driver.id);
    const firstChoice = clamp(ahead.laneOffset + side * 5.8, -BATTLE_LANE_LIMIT, BATTLE_LANE_LIMIT);
    const alternate = clamp(ahead.laneOffset - side * 5.8, -BATTLE_LANE_LIMIT, BATTLE_LANE_LIMIT);
    const desired = Math.abs(firstChoice - ahead.laneOffset) >= 5.0 ? firstChoice : alternate;
    targetLane = approachLane(projection.laneOffset, desired, 5.2);
  } else if (battleState === 'SIDE_BY_SIDE' && alongside) {
    const currentSeparation = Math.abs(projection.laneOffset - alongside.laneOffset);
    if (battleSeverity > 0.58 || currentSeparation >= SAFE_SIDE_BY_SIDE_GAP) {
      // Cars that already have a safe lane must not be pulled back toward one
      // another just because the controller calls them SIDE_BY_SIDE. Holding
      // the existing lane also keeps staggered grid rows stable off the start.
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
  } else if (battleState === 'FOLLOW' && ahead) {
    // Through corners, follow the track rather than copying a rival's lateral
    // error. On straights a tiny offset keeps the tow/racecraft readable.
    const desired = battleSeverity > 0.38
      ? baseLane
      : clamp(ahead.laneOffset + stableSide(driver.id) * 0.8, -BATTLE_LANE_LIMIT, BATTLE_LANE_LIMIT);
    targetLane = approachLane(projection.laneOffset, desired, 2.0);
  } else if (battleState === 'DEFEND') {
    const inside = Math.abs(profile.signedTurn) > 0.035
      ? Math.sign(profile.signedTurn) * 4.0
      : stableSide(driver.id) * 3.0;
    targetLane = approachLane(
      projection.laneOffset,
      clamp(inside, -BATTLE_LANE_LIMIT, BATTLE_LANE_LIMIT),
      2.8,
    );
  }

  const offRoad = projection.distance > TRACK_ROAD_HALF_WIDTH + 1.0;
  if (offRoad) {
    // Once the car has left the usable road there is no reason to preserve a
    // pretty racing line. Aim decisively at the centre and get back quickly.
    targetLane = 0;
    battleState = 'CLEAR';
  }

  const target = sampleTrack(targetProgress, targetLane);
  const targetHeading = Math.atan2(target.y - vehicle.y, target.x - vehicle.x);
  const headingError = wrapAngle(targetHeading - vehicle.heading);
  const lateralError = clamp((targetLane - projection.laneOffset) / 10.5, -1, 1);
  const recoveryGain = offRoad ? 1.10 : 0.27;
  const headingGain = offRoad ? 2.65 : 2.20;
  const yawDamping = offRoad ? 0.30 : 0.50;
  const steerCommand = headingError * headingGain
    + lateralError * recoveryGain
    - vehicle.yawRate * yawDamping;
  const steerLimit = offRoad ? 1 : 0.88;
  const steer = clamp(steerCommand, -steerLimit, steerLimit);

  const nextProfile = trackProfile(
    projection.progress + raceScaleDistance(clamp(48 + speed * 0.40, 60, 104)) / TRACK_LENGTH,
    driver.skill,
    driver.tire.grip,
  );

  const usableGrip = clamp((driver.tire.grip - 0.55) / 0.79, 0, 1);
  const skillPace = 1.08 + clamp(driver.skill - 1, -0.08, 0.24) * 0.90;
  const cornerDemand = Math.max(profile.severity, nextProfile.severity * 0.84);
  const cornerPaceFactor = 1.035 + profile.severity * usableGrip * 0.060;
  const predictionAllowance = 13 + cornerDemand * (6 + usableGrip * 15);
  const cornerExecution = 1 + cornerDemand * 0.025;
  let targetSpeed = Math.min(
    profile.targetSpeed * cornerPaceFactor,
    nextProfile.targetSpeed + predictionAllowance,
  ) * skillPace * cornerExecution;

  // Tight miniature bends punish one extra km/h much more than the old giant
  // layout. The AI should finish the corner on asphalt instead of gaining a
  // theoretical apex speed and donating seconds in runoff afterwards.
  if (cornerDemand > 0.82) targetSpeed *= 0.92;
  else if (cornerDemand > 0.68) targetSpeed *= 0.97;

  if (battleState === 'ATTACK' && profile.severity < 0.36) targetSpeed += 8;
  if (laneBlocked && ahead) {
    const desiredGap = raceScaleDistance(22);
    const buffer = raceScaleDistance(11);
    if (aheadGap < desiredGap + buffer) {
      const closingAllowance = clamp((aheadGap - desiredGap) * 0.76, -8, 9);
      targetSpeed = Math.min(targetSpeed, ahead.speed + closingAllowance);
    }
    if (aheadGap < raceScaleDistance(13)) targetSpeed = Math.min(targetSpeed, Math.max(30, ahead.speed - 4));
  }
  if (projection.distance > TRACK_ROAD_HALF_WIDTH + 1.0) targetSpeed = Math.min(targetSpeed, 52);
  if (projection.distance >= TRACK_RUNOFF_HALF_WIDTH) targetSpeed = Math.min(targetSpeed, 38);
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
        ? clamp(0.50 + speedError / 9, 0.50, 1)
        : 0.22;

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
