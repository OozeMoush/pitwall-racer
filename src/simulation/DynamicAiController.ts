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
    if (Math.abs(gap) < 18 && lateral < 34 && Math.abs(gap) < alongsideGap) {
      alongside = other;
      alongsideGap = Math.abs(gap);
    }
  }

  const laneBlocked = ahead !== undefined
    && aheadGap < 68
    && Math.abs(ahead.laneOffset - projection.laneOffset) < 22;
  const emergencyGap = laneBlocked && aheadGap < 24;
  const canAttack = laneBlocked
    && !emergencyGap
    && ahead !== undefined
    && aheadGap < 50
    && driver.tire.wear < 0.86;
  const playerThreat = behind?.isPlayer === true && behindGap < 34;

  let battleState: BattleState = 'CLEAR';
  if (alongside) battleState = 'SIDE_BY_SIDE';
  else if (canAttack) battleState = 'ATTACK';
  else if (laneBlocked && aheadGap < 76) battleState = 'FOLLOW';
  else if (playerThreat) battleState = 'DEFEND';

  let targetLane = profile.apexOffset + driver.preferredLane * 0.28;
  if (battleState === 'ATTACK' && ahead) {
    const side = stableSide(driver.id);
    const preferred = ahead.laneOffset + side * 38;
    targetLane = clamp(preferred, -48, 48);
  } else if (battleState === 'SIDE_BY_SIDE' && alongside) {
    const side = projection.laneOffset >= alongside.laneOffset ? 1 : -1;
    targetLane = clamp(alongside.laneOffset + side * 30, -48, 48);
  } else if (battleState === 'FOLLOW' && ahead) {
    targetLane = clamp(ahead.laneOffset + stableSide(driver.id) * 10, -38, 38);
  } else if (battleState === 'DEFEND') {
    const inside = Math.abs(profile.signedTurn) > 0.035
      ? Math.sign(profile.signedTurn) * 18
      : stableSide(driver.id) * 12;
    targetLane = clamp(inside, -26, 26);
  }

  if (projection.distance > 82) targetLane = 0;

  const speed = vehicle.speed;
  const lookAheadMetres = clamp(46 + speed * 0.74, 52, 122);
  const target = sampleTrack(projection.progress + lookAheadMetres / TRACK_LENGTH, targetLane);
  const targetHeading = Math.atan2(target.y - vehicle.y, target.x - vehicle.x);
  const headingError = wrapAngle(targetHeading - vehicle.heading);
  const lateralError = clamp((targetLane - projection.laneOffset) / 44, -1, 1);
  const steer = clamp(headingError * 1.86 + lateralError * 0.22, -1, 1);

  const nextProfile = trackProfile(
    projection.progress + clamp(58 + speed * 0.6, 64, 126) / TRACK_LENGTH,
    driver.skill,
    driver.tire.grip,
  );
  const skillPace = 0.92 + clamp(driver.skill - 1, -0.08, 0.1) * 0.72;
  let targetSpeed = Math.min(profile.targetSpeed, nextProfile.targetSpeed + 9) * skillPace;

  if (battleState === 'ATTACK' && profile.severity < 0.34) targetSpeed += 5.5;
  if (laneBlocked && ahead) {
    // Physical cars are about 15-20 simulation metres long. Keeping 30m here
    // means FOLLOW is a real gap rather than an instruction to sit inside the
    // leader's collider. Below 24m we brake decisively instead of buzzing.
    const desiredGap = 30;
    if (aheadGap < desiredGap + 12) {
      const closingAllowance = clamp((aheadGap - desiredGap) * 0.28, -8, 3.5);
      targetSpeed = Math.min(targetSpeed, ahead.speed + closingAllowance);
    }
    if (aheadGap < 24) targetSpeed = Math.min(targetSpeed, Math.max(26, ahead.speed - 7));
  }
  if (projection.distance > 82) targetSpeed = Math.min(targetSpeed, 54);
  targetSpeed = clamp(targetSpeed, 34, 101);

  const speedError = targetSpeed - speed;
  const brake = speedError < -1.5
    ? clamp((-speedError - 0.5) / 16, 0.18, 1)
    : 0;
  const throttle = brake > 0.08
    ? 0
    : speedError > 8
      ? 1
      : speedError > 1
        ? clamp(0.3 + speedError / 14, 0.3, 0.9)
        : 0.12;

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
