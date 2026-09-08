import { raceDistance, type BattleState, type DriverState, type RaceTrafficCar } from './RaceModel';
import { projectTrack, sampleTrack, TRACK_LENGTH } from './TrackModel';
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
    if (Math.abs(gap) < 18 && lateral < 18 && Math.abs(gap) < alongsideGap) {
      alongside = other;
      alongsideGap = Math.abs(gap);
    }
  }

  const laneBlocked = ahead !== undefined
    && aheadGap < 68
    && Math.abs(ahead.laneOffset - projection.laneOffset) < 11;
  const emergencyGap = laneBlocked && aheadGap < 22;
  const canAttack = laneBlocked
    && !emergencyGap
    && ahead !== undefined
    && aheadGap < 54
    && driver.tire.wear < 0.92;
  const playerThreat = behind?.isPlayer === true && behindGap < 46;

  let battleState: BattleState = 'CLEAR';
  if (alongside) battleState = 'SIDE_BY_SIDE';
  else if (canAttack) battleState = 'ATTACK';
  else if (laneBlocked && aheadGap < 78) battleState = 'FOLLOW';
  else if (playerThreat) battleState = 'DEFEND';

  let targetLane = clamp(profile.apexOffset * 0.8 + driver.preferredLane * 0.12, -12, 12);
  if (battleState === 'ATTACK' && ahead) {
    const side = stableSide(driver.id);
    targetLane = clamp(ahead.laneOffset + side * 15, -17, 17);
  } else if (battleState === 'SIDE_BY_SIDE' && alongside) {
    const side = projection.laneOffset >= alongside.laneOffset ? 1 : -1;
    targetLane = clamp(alongside.laneOffset + side * 14, -17, 17);
  } else if (battleState === 'FOLLOW' && ahead) {
    targetLane = clamp(ahead.laneOffset + stableSide(driver.id) * 4.5, -14, 14);
  } else if (battleState === 'DEFEND') {
    const inside = Math.abs(profile.signedTurn) > 0.035
      ? Math.sign(profile.signedTurn) * 9
      : stableSide(driver.id) * 6;
    targetLane = clamp(inside, -11, 11);
  }

  if (projection.distance > 27) {
    targetLane = 0;
    battleState = 'CLEAR';
  }

  const speed = vehicle.speed;
  // The previous controller looked too far ahead and braked like a cautious
  // road car. Shorter look-ahead lets a high-grip AI actually use the tyre.
  const lookAheadMetres = clamp(42 + speed * 0.62, 50, 118);
  const target = sampleTrack(projection.progress + lookAheadMetres / TRACK_LENGTH, targetLane);
  const targetHeading = Math.atan2(target.y - vehicle.y, target.x - vehicle.x);
  const headingError = wrapAngle(targetHeading - vehicle.heading);
  const lateralError = clamp((targetLane - projection.laneOffset) / 18, -1, 1);
  const recoveryGain = projection.distance > 24 ? 0.50 : 0.30;
  const steer = clamp(headingError * 2.18 + lateralError * recoveryGain, -1, 1);

  const nextProfile = trackProfile(
    projection.progress + clamp(54 + speed * 0.50, 64, 120) / TRACK_LENGTH,
    driver.skill,
    driver.tire.grip,
  );

  const usableGrip = clamp((driver.tire.grip - 0.5) / 0.84, 0, 1);
  const skillPace = 1.08 + clamp(driver.skill - 1, -0.08, 0.24) * 0.92;
  const predictionAllowance = 14 + usableGrip * 18;
  let targetSpeed = Math.min(
    profile.targetSpeed * (1.035 + usableGrip * 0.055),
    nextProfile.targetSpeed + predictionAllowance,
  ) * skillPace;

  if (battleState === 'ATTACK' && profile.severity < 0.36) targetSpeed += 10;
  if (laneBlocked && ahead) {
    const desiredGap = 24;
    if (aheadGap < desiredGap + 12) {
      const closingAllowance = clamp((aheadGap - desiredGap) * 0.34, -10, 7);
      targetSpeed = Math.min(targetSpeed, ahead.speed + closingAllowance);
    }
    if (aheadGap < 20) targetSpeed = Math.min(targetSpeed, Math.max(28, ahead.speed - 7));
  }
  if (projection.distance > 27) targetSpeed = Math.min(targetSpeed, 58);
  if (projection.distance > 34) targetSpeed = Math.min(targetSpeed, 42);
  targetSpeed = clamp(targetSpeed, 28, 130);

  const speedError = targetSpeed - speed;
  const brake = speedError < -1.8
    ? clamp((-speedError - 0.4) / 14.5, 0.14, 1)
    : 0;
  const throttle = brake > 0.08
    ? 0
    : speedError > 5
      ? 1
      : speedError > 0.4
        ? clamp(0.48 + speedError / 10, 0.48, 1)
        : 0.27;

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
