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

/**
 * Physical AI for the race weekend.
 *
 * Clean-air pace is now defined by the generated machine-limit reference lap.
 * Driver skill is only an execution percentage of that reference; it never
 * becomes extra engine power, hidden tyre grip, or a hand-authored lap-time
 * target. Traffic can move the car off the reference line, but once clear it
 * returns to the same line/braking plan a perfect reference driver would use.
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

    if (gap > 0 && lateral < AHEAD_SEARCH_LATERAL && gap < aheadGap) {
      ahead = other;
      aheadGap = gap;
      aheadLateral = lateral;
    }

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

  const trackId = getActiveTrack().id;
  const execution = referenceExecutionForSkill(driver.skill);
  const speed = vehicle.speed;
  const technicalLookahead = 1 - clamp((profile.severity - 0.62) / 0.38, 0, 1) * 0.24;
  const lookAheadMetres = clamp(34 + speed * 0.52, 46, 94) * technicalLookahead;
  const targetProgress = projection.progress + lookAheadMetres / TRACK_LENGTH;
  const lineReference = referenceTarget(trackId, targetProgress, driver.tire.grip);
  const baseLane = clamp(lineReference.laneOffset, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);

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

  const speedReference = referenceTarget(trackId, projection.progress, driver.tire.grip);
  let targetSpeed = speedReference.targetSpeed * execution;

  // In a battle the better driver may execute closer to 100% of the same
  // reference, but nobody is allowed to exceed the machine-limit target. Tow
  // remains a physical aero effect in RapierRacePhysics rather than a speed
  // multiplier hidden in the AI controller.
  if (battleState === 'ATTACK' && profile.severity < 0.42) {
    targetSpeed = speedReference.targetSpeed * Math.min(1, execution + 0.008);
  }
  if (battleState === 'SIDE_BY_SIDE' && alongside) {
    const performanceDelta = driver.skill * driver.tire.grip - alongside.performance;
    if (performanceDelta > 0.002 && profile.severity < 0.48) {
      targetSpeed = speedReference.targetSpeed * Math.min(1, execution + 0.006);
    } else if (performanceDelta < -0.002) {
      targetSpeed = speedReference.targetSpeed * Math.max(0.972, execution - 0.005);
    }
  }

  // Pace-match only while physically blocked. Once the attacker has moved out
  // of the leader's lane it returns to its own reference target and can finish
  // the pass with tow/clean-air physics rather than a scripted speed bonus.
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
  const feedbackBrake = speedError < -0.8
    ? clamp((-speedError - 0.15) / 8.2, 0.08, 1)
    : 0;
  let brake = Math.max(speedReference.brake, feedbackBrake);

  let throttle: number;
  if (speedError > 1.4) {
    throttle = 1;
  } else if (speedError > 0.15) {
    throttle = Math.max(speedReference.throttle, clamp(0.50 + speedError / 5.5, 0.50, 1));
  } else if (speedError < -0.15) {
    throttle = speedReference.throttle * clamp(1 + speedError / 2.0, 0, 1);
  } else {
    throttle = speedReference.throttle;
  }

  // Traffic may force a lower target than the clean-air reference. In that
  // case feedback wins; otherwise use the reference driver's braking/throttle
  // trace before an error develops instead of reacting one segment late.
  if (brake > 0.06) throttle = 0;
  if (offRoad) {
    brake = Math.max(brake, speed > targetSpeed + 1 ? 0.22 : 0);
    throttle = brake > 0.08 ? 0 : Math.max(throttle, 0.55);
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
