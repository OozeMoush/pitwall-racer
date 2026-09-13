import { raceDistance, type BattleState, type DriverState, type RaceTrafficCar } from './RaceModel';
import { AI_SAFE_LANE_LIMIT, TRACK_ROAD_HALF_WIDTH, TRACK_RUNOFF_HALF_WIDTH } from './TrackLimitsModel';
import { projectTrackNear, raceScaleDistance, sampleTrack, TRACK_LENGTH } from './TrackModel';
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

export function dynamicAiControl(
  driver: DriverState,
  vehicle: VehicleState,
  traffic: readonly RaceTrafficCar[],
): DynamicAiControl {
  // Miniature layouts can put unrelated pieces of asphalt close together.
  // Anchor projection to the driver's previous race progress so a small
  // excursion never makes the controller suddenly chase another road.
  const projection = projectTrackNear(vehicle.x, vehicle.y, driver.progress);
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

    // Only the player needs hard side-by-side avoidance. AI-to-AI contact is
    // already resolved by the racecraft line, and making every AI react to the
    // lateral motion of every neighbour caused the whole pack to snake.
    if (other.isPlayer === true
      && battleSafe
      && Math.abs(gap) < 12.5
      && lateral < 13.5
      && Math.abs(gap) < alongsideGap) {
      alongside = other;
      alongsideGap = Math.abs(gap);
    }
  }

  // Traffic distances use miniature race scaling, as they did in the stable
  // pack tuning. The cars themselves are still full collision size, so retain
  // a physical emergency floor rather than allowing a zero-gap train.
  const laneBlockedRange = Math.max(28, raceScaleDistance(80));
  const attackRange = Math.max(24, raceScaleDistance(70));
  const followRange = Math.max(30, raceScaleDistance(86));
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
  const lookAheadMetres = raceScaleDistance(clamp(38 + speed * 0.44, 48, 96));
  const targetProgress = projection.progress + lookAheadMetres / TRACK_LENGTH;
  const baseLane = clamp(
    racingLineOffset(targetProgress, driver.tire.grip) + driver.preferredLane * 0.06,
    -AI_SAFE_LANE_LIMIT,
    AI_SAFE_LANE_LIMIT,
  );

  // Normal line changes are deliberately gradual. Passing moves are larger,
  // but only on geometry classified as safe; AI-vs-AI moves are a little
  // calmer than moves around the player to avoid repeated left/right feints.
  let targetLane = approachLane(projection.laneOffset, baseLane, 2.8);

  if (battleState === 'ATTACK' && ahead) {
    const side = stableSide(driver.id);
    const passOffset = ahead.isPlayer === true ? 5.8 : 4.4;
    const firstChoice = clamp(ahead.laneOffset + side * passOffset, -BATTLE_LANE_LIMIT, BATTLE_LANE_LIMIT);
    const alternate = clamp(ahead.laneOffset - side * passOffset, -BATTLE_LANE_LIMIT, BATTLE_LANE_LIMIT);
    const desired = Math.abs(firstChoice - ahead.laneOffset) >= passOffset * 0.82 ? firstChoice : alternate;
    targetLane = approachLane(projection.laneOffset, desired, ahead.isPlayer === true ? 4.8 : 3.8);
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
      targetLane = approachLane(projection.laneOffset, desired, 3.4);
    }
  } else if (battleState === 'FOLLOW') {
    // Follow the circuit, not the leading car's lateral corrections. This is
    // the key anti-snake rule: a small wobble must not propagate down the train.
    targetLane = approachLane(projection.laneOffset, baseLane, 2.4);
  }

  const offRoad = projection.distance > TRACK_ROAD_HALF_WIDTH + 1.0;
  if (offRoad) {
    targetLane = 0;
    battleState = 'CLEAR';
  }

  const target = sampleTrack(targetProgress, targetLane);
  const targetHeading = Math.atan2(target.y - vehicle.y, target.x - vehicle.x);
  const headingError = wrapAngle(targetHeading - vehicle.heading);
  const lateralError = clamp((targetLane - projection.laneOffset) / 10.0, -1, 1);
  const recoveryGain = offRoad ? 1.10 : 0.36;
  const headingGain = offRoad ? 2.85 : 2.72;
  const yawDamping = offRoad ? 0.28 : 0.46;
  const steerCommand = headingError * headingGain
    + lateralError * recoveryGain
    - vehicle.yawRate * yawDamping;
  const steerLimit = offRoad ? 1 : 0.92;
  const steer = clamp(steerCommand, -steerLimit, steerLimit);

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
  const cornerExecution = 1 + cornerDemand * 0.045;
  let targetSpeed = Math.min(
    profile.targetSpeed * cornerPaceFactor,
    nextProfile.targetSpeed + predictionAllowance,
  ) * skillPace * cornerExecution;

  if (battleState === 'ATTACK' && profile.severity < 0.36) targetSpeed += 9;

  if (laneBlocked && ahead) {
    const desiredGap = Math.max(9.5, raceScaleDistance(24));
    const buffer = Math.max(4.0, raceScaleDistance(13));
    if (aheadGap < desiredGap + buffer) {
      const closingAllowance = clamp((aheadGap - desiredGap) * 0.72, -8, 9);
      targetSpeed = Math.min(targetSpeed, ahead.speed + closingAllowance);
    }
    if (aheadGap < 8.8) {
      targetSpeed = Math.min(targetSpeed, Math.max(30, ahead.speed - 4));
    }
  }

  if (projection.distance > TRACK_ROAD_HALF_WIDTH + 1.0) targetSpeed = Math.min(targetSpeed, 56);
  if (projection.distance >= TRACK_RUNOFF_HALF_WIDTH) targetSpeed = Math.min(targetSpeed, 40);
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
