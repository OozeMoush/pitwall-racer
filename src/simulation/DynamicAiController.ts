import { raceDistance, type BattleState, type DriverState, type RaceTrafficCar } from './RaceModel';
import { referenceExecutionForSkill, referenceTarget } from './ReferenceDriverModel';
import { AI_SAFE_LANE_LIMIT, TRACK_ROAD_HALF_WIDTH, TRACK_RUNOFF_HALF_WIDTH } from './TrackLimitsModel';
import { getActiveTrack, projectTrackNear, sampleTrack, TRACK_LENGTH } from './TrackModel';
import { trackProfile } from './TrackProfile';
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
const ALONGSIDE_ENTRY_RANGE = 10.5;
const ALONGSIDE_EXIT_RANGE = 13.0;

/**
 * Physical AI for the race weekend.
 *
 * Clean-air pace is defined by the generated machine-limit reference lap.
 * Driver skill is only an execution percentage of that reference; it never
 * becomes extra engine power, hidden tyre grip, or a hand-authored lap-time
 * target. Traffic can move the car off the reference line, but once clear it
 * returns to the same trajectory a perfect reference driver would use.
 */
export function dynamicAiControl(
  driver: DriverState,
  vehicle: VehicleState,
  traffic: readonly RaceTrafficCar[],
): DynamicAiControl {
  const projection = projectTrackNear(vehicle.x, vehicle.y, driver.progress);
  const profile = trackProfile(projection.progress, 1, driver.tire.grip);
  const battlePreview = trackProfile(
    projection.progress + 72 / TRACK_LENGTH,
    1,
    driver.tire.grip,
  );
  const battleSeverity = Math.max(profile.severity, battlePreview.severity * 0.92);
  const battleSafe = battleSeverity < 0.52
    && projection.distance < Math.min(TRACK_ROAD_HALF_WIDTH + 0.5, BATTLE_LANE_LIMIT + 1.0);
  const driverDistance = raceDistance(driver.lap, projection.progress) * TRACK_LENGTH;
  const alongsideRange = driver.battleState === 'SIDE_BY_SIDE'
    ? ALONGSIDE_EXIT_RANGE
    : ALONGSIDE_ENTRY_RANGE;
  const committedLateralSearch = driver.battleState === 'ATTACK' || driver.battleState === 'SIDE_BY_SIDE'
    ? 13.5
    : AHEAD_SEARCH_LATERAL;

  let ahead: RaceTrafficCar | undefined;
  let aheadGap = Number.POSITIVE_INFINITY;
  let aheadLateral = Number.POSITIVE_INFINITY;
  let alongside: RaceTrafficCar | undefined;
  let alongsideGap = Number.POSITIVE_INFINITY;
  let alongsideSignedGap = 0;

  for (const other of traffic) {
    if (other.id === driver.id) continue;
    const otherDistance = raceDistance(other.lap, other.progress) * TRACK_LENGTH;
    const gap = otherDistance - driverDistance;
    const lateral = Math.abs(other.laneOffset - projection.laneOffset);

    if (gap > 0 && lateral < committedLateralSearch && gap < aheadGap) {
      ahead = other;
      aheadGap = gap;
      aheadLateral = lateral;
    }

    if (battleSafe
      && Math.abs(gap) < alongsideRange
      && lateral >= 3.4
      && lateral < 11.8
      && Math.abs(gap) < alongsideGap) {
      alongside = other;
      alongsideGap = Math.abs(gap);
      alongsideSignedGap = gap;
    }
  }

  const laneBlockedRange = 38;
  const attackRange = 16;
  const followRange = 44;
  const laneBlocked = ahead !== undefined
    && aheadGap < laneBlockedRange
    && aheadLateral < BLOCKING_LANE_WIDTH;
  const canAttack = battleSafe
    && ahead !== undefined
    && aheadGap < attackRange
    && aheadLateral < committedLateralSearch
    && driver.tire.wear < 0.94;

  let battleState: BattleState = 'CLEAR';
  if (alongside) battleState = 'SIDE_BY_SIDE';
  else if (canAttack) battleState = 'ATTACK';
  else if (laneBlocked && aheadGap < followRange) battleState = 'FOLLOW';

  const trackId = getActiveTrack().id;
  const execution = referenceExecutionForSkill(driver.skill);
  const speed = vehicle.speed;

  const technicalLookahead = 1 - clamp((profile.severity - 0.58) / 0.42, 0, 1) * 0.22;
  const lookAheadMetres = clamp(18 + speed * 0.32, 28, 60) * technicalLookahead;
  const targetProgress = projection.progress + lookAheadMetres / TRACK_LENGTH;
  const lineReference = referenceTarget(trackId, targetProgress, driver.tire.grip);
  const currentLineReference = referenceTarget(trackId, projection.progress, driver.tire.grip);
  const baseLane = clamp(lineReference.laneOffset, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);

  // Move quickly enough to realize the baked cross-track trajectory, while
  // remaining far below the unstable jump used in the rejected feed-forward
  // experiment.
  let targetLane = approachLane(projection.laneOffset, baseLane, 2.6);

  if (battleState === 'ATTACK' && ahead) {
    const passOffset = ahead.isPlayer === true ? 7.6 : 7.0;
    const positive = clamp(ahead.laneOffset + passOffset, -BATTLE_LANE_LIMIT, BATTLE_LANE_LIMIT);
    const negative = clamp(ahead.laneOffset - passOffset, -BATTLE_LANE_LIMIT, BATTLE_LANE_LIMIT);
    const positiveRoom = Math.abs(positive - ahead.laneOffset);
    const negativeRoom = Math.abs(negative - ahead.laneOffset);
    const relativeLane = projection.laneOffset - ahead.laneOffset;

    let desired: number;
    if (positiveRoom < passOffset * 0.80) desired = negative;
    else if (negativeRoom < passOffset * 0.80) desired = positive;
    else if (Math.abs(relativeLane) > 2.0) {
      desired = relativeLane > 0 ? positive : negative;
    } else {
      const positiveCost = Math.abs(positive - baseLane);
      const negativeCost = Math.abs(negative - baseLane);
      desired = Math.abs(positiveCost - negativeCost) < 0.25
        ? (stableSide(driver.id) > 0 ? positive : negative)
        : positiveCost < negativeCost ? positive : negative;
    }
    targetLane = approachLane(projection.laneOffset, desired, 3.2);
  } else if (battleState === 'SIDE_BY_SIDE' && alongside) {
    const currentSeparation = Math.abs(projection.laneOffset - alongside.laneOffset);

    // The car that is still marginally ahead owns its lane. Only the attacker
    // coming from behind creates extra lateral room. Previously both cars fled
    // from one another, turning a normal pass into a 15-30 m road split and
    // wasting the quicker car's longitudinal advantage.
    if (alongsideSignedGap < -0.75) {
      targetLane = clamp(projection.laneOffset, -BATTLE_LANE_LIMIT, BATTLE_LANE_LIMIT);
    } else if (currentSeparation >= SAFE_SIDE_BY_SIDE_GAP) {
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

  const battleActive = battleState === 'ATTACK' || battleState === 'SIDE_BY_SIDE';
  const steeringLookAheadMetres = battleActive
    ? Math.min(32, lookAheadMetres)
    : lookAheadMetres;
  const steeringProgress = offRoad
    ? projection.progress + 18 / TRACK_LENGTH
    : projection.progress + steeringLookAheadMetres / TRACK_LENGTH;
  const target = sampleTrack(steeringProgress, targetLane);
  const tangentDistance = battleActive ? 6 : 8;
  const tangentProgress = steeringProgress + tangentDistance / TRACK_LENGTH;
  const tangentLane = offRoad
    ? 0
    : battleState === 'CLEAR' || battleState === 'FOLLOW'
      ? clamp(referenceTarget(trackId, tangentProgress, driver.tire.grip).laneOffset, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT)
      : targetLane;
  const tangent = sampleTrack(tangentProgress, tangentLane);
  const pathHeading = Math.atan2(tangent.y - target.y, tangent.x - target.x);
  const bearingHeading = Math.atan2(target.y - vehicle.y, target.x - vehicle.x);
  const headingError = wrapAngle(pathHeading - vehicle.heading);
  const bearingError = wrapAngle(bearingHeading - vehicle.heading);
  const referenceLaneNow = offRoad
    ? 0
    : battleState === 'CLEAR' || battleState === 'FOLLOW'
      ? clamp(currentLineReference.laneOffset, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT)
      : targetLane;
  const lateralError = clamp((referenceLaneNow - projection.laneOffset) / 9.0, -1, 1);
  const battleOverflow = battleActive
    ? clamp((Math.abs(projection.laneOffset) - BATTLE_LANE_LIMIT) / 4.0, 0, 1)
    : 0;
  const overflowCorrection = battleOverflow > 0
    ? -Math.sign(projection.laneOffset) * battleOverflow * 0.65
    : 0;
  const steerCommand = offRoad
    ? bearingError * 3.25 + lateralError * 1.20 - vehicle.yawRate * 0.25
    : battleActive
      ? headingError * 2.10
        + bearingError * 1.02
        + lateralError * 0.78
        - vehicle.yawRate * 0.40
        + overflowCorrection
      : headingError * 2.15
        + bearingError * 0.82
        + lateralError * 0.52
        - vehicle.yawRate * 0.38;
  const steer = clamp(steerCommand, offRoad ? -1 : -0.98, offRoad ? 1 : 0.98);

  const speedReference = currentLineReference;
  let targetSpeed = speedReference.targetSpeed * execution;

  if (battleState === 'ATTACK' && profile.severity < 0.42) {
    targetSpeed = speedReference.targetSpeed * Math.min(1, execution + 0.010);
  }
  if (battleState === 'SIDE_BY_SIDE' && alongside) {
    const performanceDelta = driver.skill * driver.tire.grip - alongside.performance;
    if (performanceDelta > 0.002 && profile.severity < 0.48) {
      const advantage = clamp(performanceDelta * 0.24, 0.004, 0.012);
      targetSpeed = speedReference.targetSpeed * Math.min(1, execution + advantage);
    } else if (performanceDelta < -0.002) {
      const compromise = clamp(-performanceDelta * 0.18, 0.003, 0.010);
      targetSpeed = speedReference.targetSpeed * Math.max(0.972, execution - compromise);
    }
  }

  if (laneBlocked && ahead && battleState !== 'ATTACK') {
    const desiredGap = 8.8;
    const buffer = 4.8;
    if (aheadGap < desiredGap + buffer) {
      const closingAllowance = clamp((aheadGap - desiredGap) * 0.82, -7, 9);
      targetSpeed = Math.min(targetSpeed, ahead.speed + closingAllowance);
    }
  }
  if (laneBlocked && ahead && aheadGap < 6.8) {
    targetSpeed = Math.min(targetSpeed, Math.max(28, ahead.speed - 2.5));
  }

  if (projection.distance > TRACK_ROAD_HALF_WIDTH + 1.0) targetSpeed = Math.min(targetSpeed, 58);
  if (projection.distance >= TRACK_RUNOFF_HALF_WIDTH) targetSpeed = Math.min(targetSpeed, 36);
  targetSpeed = clamp(targetSpeed, 26, 136);

  const speedError = targetSpeed - speed;
  const overspeed = -speedError;
  const feedbackBrake = overspeed > 0.65
    ? clamp((overspeed - 0.20) / 9.4, 0.05, 1)
    : 0;
  const plannedBrakeWeight = clamp((1.15 - speedError) / 2.3, 0, 1);
  let brake = Math.max(feedbackBrake, speedReference.brake * 0.82 * plannedBrakeWeight);

  let throttle: number;
  if (brake > 0.06) {
    throttle = 0;
  } else if (speedError > 0.45) {
    throttle = 1;
  } else if (speedError > -0.55) {
    throttle = Math.max(speedReference.throttle, clamp(0.60 + speedError * 0.32, 0.48, 1));
  } else {
    throttle = speedReference.throttle * clamp(1 + speedError / 3.0, 0, 1);
  }

  if (offRoad) {
    brake = Math.max(brake, speed > targetSpeed + 1 ? 0.18 : 0);
    throttle = brake > 0.08 ? 0 : Math.max(throttle, 0.58);
  }

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
