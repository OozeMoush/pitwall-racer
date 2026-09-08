import type { BattleState, DriverState, RaceTrafficCar } from './RaceModel';
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
  const raceDistance = (Math.max(0, driver.lap - 1) + projection.progress) * TRACK_LENGTH;

  let ahead: RaceTrafficCar | undefined;
  let aheadGap = Number.POSITIVE_INFINITY;
  let behind: RaceTrafficCar | undefined;
  let behindGap = Number.POSITIVE_INFINITY;
  let alongside: RaceTrafficCar | undefined;
  let alongsideGap = Number.POSITIVE_INFINITY;

  for (const other of traffic) {
    if (other.id === driver.id) continue;
    const otherDistance = (Math.max(0, other.lap - 1) + other.progress) * TRACK_LENGTH;
    const gap = otherDistance - raceDistance;
    const lateral = Math.abs(other.laneOffset - projection.laneOffset);

    if (gap > 0 && gap < aheadGap) {
      ahead = other;
      aheadGap = gap;
    }
    if (gap < 0 && -gap < behindGap) {
      behind = other;
      behindGap = -gap;
    }
    if (Math.abs(gap) < 18 && lateral < 28 && Math.abs(gap) < alongsideGap) {
      alongside = other;
      alongsideGap = Math.abs(gap);
    }
  }

  const laneBlocked = ahead !== undefined
    && aheadGap < 68
    && Math.abs(ahead.laneOffset - projection.laneOffset) < 18;
  const emergencyGap = laneBlocked && aheadGap < 24;
  const canAttack = laneBlocked
    && !emergencyGap
    && ahead !== undefined
    && aheadGap < 50
    && driver.tire.wear < 0.88;
  const playerThreat = behind?.isPlayer === true && behindGap < 38;

  let battleState: BattleState = 'CLEAR';
  if (alongside) battleState = 'SIDE_BY_SIDE';
  else if (canAttack) battleState = 'ATTACK';
  else if (laneBlocked && aheadGap < 76) battleState = 'FOLLOW';
  else if (playerThreat) battleState = 'DEFEND';

  let targetLane = profile.apexOffset * 0.78 + driver.preferredLane * 0.22;
  if (battleState === 'ATTACK' && ahead) {
    const side = stableSide(driver.id);
    const preferred = ahead.laneOffset + side * 28;
    targetLane = clamp(preferred, -34, 34);
  } else if (battleState === 'SIDE_BY_SIDE' && alongside) {
    const side = projection.laneOffset >= alongside.laneOffset ? 1 : -1;
    targetLane = clamp(alongside.laneOffset + side * 23, -34, 34);
  } else if (battleState === 'FOLLOW' && ahead) {
    targetLane = clamp(ahead.laneOffset + stableSide(driver.id) * 7, -28, 28);
  } else if (battleState === 'DEFEND') {
    const inside = Math.abs(profile.signedTurn) > 0.035
      ? Math.sign(profile.signedTurn) * 14
      : stableSide(driver.id) * 9;
    targetLane = clamp(inside, -20, 20);
  }

  if (projection.distance > 62) targetLane = 0;

  const speed = vehicle.speed;
  const lookAheadMetres = clamp(44 + speed * 0.72, 50, 120);
  const target = sampleTrack(projection.progress + lookAheadMetres / TRACK_LENGTH, targetLane);
  const targetHeading = Math.atan2(target.y - vehicle.y, target.x - vehicle.x);
  const headingError = wrapAngle(targetHeading - vehicle.heading);
  const lateralError = clamp((targetLane - projection.laneOffset) / 34, -1, 1);
  const steer = clamp(headingError * 1.9 + lateralError * 0.25, -1, 1);

  const nextProfile = trackProfile(
    projection.progress + clamp(56 + speed * 0.6, 62, 124) / TRACK_LENGTH,
    driver.skill,
    driver.tire.grip,
  );

  // Previous AI deliberately ran below its own skill score. That made a careful
  // Medium player able to drive away from fresh Soft cars. Skill now translates
  // directly into race pace; compound grip still decides where the time appears.
  const skillPace = 1 + clamp(driver.skill - 1, -0.08, 0.13) * 0.88;
  let targetSpeed = Math.min(profile.targetSpeed, nextProfile.targetSpeed + 10) * skillPace;

  if (battleState === 'ATTACK' && profile.severity < 0.34) targetSpeed += 6.5;
  if (laneBlocked && ahead) {
    const desiredGap = 29;
    if (aheadGap < desiredGap + 12) {
      const closingAllowance = clamp((aheadGap - desiredGap) * 0.3, -8, 4);
      targetSpeed = Math.min(targetSpeed, ahead.speed + closingAllowance);
    }
    if (aheadGap < 23) targetSpeed = Math.min(targetSpeed, Math.max(26, ahead.speed - 7));
  }
  if (projection.distance > 62) targetSpeed = Math.min(targetSpeed, 50);
  targetSpeed = clamp(targetSpeed, 32, 108);

  const speedError = targetSpeed - speed;
  const brake = speedError < -1.35
    ? clamp((-speedError - 0.4) / 15, 0.18, 1)
    : 0;
  const throttle = brake > 0.08
    ? 0
    : speedError > 7
      ? 1
      : speedError > 0.8
        ? clamp(0.34 + speedError / 13, 0.34, 0.95)
        : 0.15;

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
