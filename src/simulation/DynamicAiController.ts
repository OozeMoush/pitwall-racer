import { sampleRacingLineAsset } from './RacingLineAsset';
import { explicitLineFollower } from './ExplicitLineFollower';
import { predictiveAiSteer } from './PredictiveAiSteering';
import { predictiveExplicitLineSteer } from './PredictiveExplicitLineSteering';
import { driverPerformanceAt } from './DriverPerformanceModel';
import { raceDistance, type BattleState, type DriverState, type RaceTrafficCar } from './RaceModel';
import {
  activeReferenceTarget,
  racingLineBrakeIntent,
  racingLineLocalBrakeIntent,
  racingLineThrottleIntent,
  runtimeRacingLine,
} from './RacingLineRuntime';
import {
  trackAiSafeLaneLimit,
  trackKerbOuterOffset,
  trackRunoffHalfWidth,
} from './TrackLimitsModel';
import { getActiveTrack, projectTrackNear, sampleTrack, TRACK_LENGTH } from './TrackModel';
import { trackProfile } from './TrackProfile';
import type { VehicleState } from './VehicleModel';

export interface DynamicAiDebug {
  lineSource: 'AUTO' | 'PLAYER' | 'EDITOR' | 'OPTIMIZER';
  progress: number;
  centerProgress: number;
  referenceLane: number;
  laneError: number;
  pathError: number;
  lookAheadMetres: number;
  steeringProgress: number;
  predictionWeight: number;
  feedbackBrake: number;
  profileBrake: number;
  profileThrottle: number;
  demonstratedDynamics: boolean;
  demonstratedAcceleration: boolean;
  demonstratedGripTrace: boolean;
  demonstratedForwardAcceleration: boolean;
  sourceGrip?: number;
  sourceForwardAcceleration?: number;
  sourceNetSpeedAcceleration?: number;
  targetYawRate?: number;
  pathHeadingError: number;
  bearingError: number;
  driverExecutionFactor: number;
}

export interface DynamicAiControl {
  throttle: number;
  brake: number;
  steer: number;
  targetSpeed: number;
  targetLane: number;
  battleState: BattleState;
  debug: DynamicAiDebug;
}

const AHEAD_SEARCH_LATERAL = 10.0;
const BLOCKING_LANE_WIDTH = 5.4;
const AI_PACE_CHEAT_MIN = 1.055;
const AI_PACE_CHEAT_MAX = 1.085;
const AI_SKILL_GRIP_MAX = 1.010;
const AI_POWER_BONUS_MIN = 0.065;
const AI_POWER_BONUS_MAX = 0.115;

export function aiPaceCheatForSkill(skill: number): number {
  const t = clamp((skill - 1.118) / (1.136 - 1.118), 0, 1);
  return AI_PACE_CHEAT_MIN
    + (AI_PACE_CHEAT_MAX - AI_PACE_CHEAT_MIN) * t;
}

export function aiGripMultiplier(compound: DriverState['tire']['compound']): number {
  if (compound === 'SOFT') return 1.075;
  if (compound === 'MEDIUM') return 1.055;
  return 1.045;
}

export function aiSkillGripMultiplier(skill: number): number {
  const t = clamp((skill - 1.118) / (1.136 - 1.118), 0, 1);
  return 1 + (AI_SKILL_GRIP_MAX - 1) * t;
}

export function aiPowerBoostForSkill(skill: number): number {
  const t = clamp((skill - 1.118) / (1.136 - 1.118), 0, 1);
  return AI_POWER_BONUS_MIN
    + (AI_POWER_BONUS_MAX - AI_POWER_BONUS_MIN) * t;
}

export function aiEffectiveGrip(driver: DriverState): number {
  return driver.tire.grip
    * aiGripMultiplier(driver.tire.compound)
    * aiSkillGripMultiplier(driver.skill);
}

/**
 * Physical AI for the race weekend.
 *
 * Clean-air pace is defined by the generated machine-limit reference lap.
 * Driver skill is only an execution percentage of that reference; it never
 * becomes extra engine power, hidden tyre grip, or a hand-authored lap-time
 * target. Traffic is longitudinal only: a blocked CPU may reduce speed, but
 * every CPU keeps steering toward the same reference line.
 *
 * Pitwall's two tight direction-change complexes get a small predictive
 * steering assist. It uses the shared arcade-car equations to begin rotation
 * before the ordinary closed-loop follower accumulates a large lane error.
 * A small clean-air corner attack is allowed only while the car is already
 * tracking the reference well; it asks the same physical chassis to carry a
 * little more speed and disappears immediately when line error grows.
 */
export function dynamicAiControl(
  driver: DriverState,
  vehicle: VehicleState,
  traffic: readonly RaceTrafficCar[],
): DynamicAiControl {
  const projection = projectTrackNear(vehicle.x, vehicle.y, driver.progress);
  const referenceGhost = driver.id === 'debug-reference-ghost';
  const controlGrip = referenceGhost ? driver.tire.grip : aiEffectiveGrip(driver);
  const paceCheat = referenceGhost
    ? 1
    : aiPaceCheatForSkill(driver.skill);
  const profile = trackProfile(projection.progress, 1, controlGrip);
  const driverPerformance = referenceGhost
    ? undefined
    : driverPerformanceAt(driver, projection.progress, profile.severity);
  const driverDistance = raceDistance(driver.lap, projection.progress) * TRACK_LENGTH;

  let ahead: RaceTrafficCar | undefined;
  let aheadGap = Number.POSITIVE_INFINITY;
  let aheadLateral = Number.POSITIVE_INFINITY;

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
  }

  const laneBlocked = ahead !== undefined
    && aheadGap < 34
    && aheadLateral < BLOCKING_LANE_WIDTH;
  let battleState: BattleState =
    laneBlocked && aheadGap < 40 ? 'FOLLOW' : 'CLEAR';

  const trackId = getActiveTrack().id;
  const speed = vehicle.speed;
  const lineAsset = runtimeRacingLine(trackId);
  const highFidelityLine = lineAsset?.source === 'PLAYER' || lineAsset?.source === 'EDITOR';

  const technicalLookahead = 1 - clamp((profile.severity - 0.58) / 0.42, 0, 1) * 0.22;
  const lookAheadMetres = highFidelityLine
    ? clamp(16 + speed * 0.22, 24, 46) * technicalLookahead
    : clamp(18 + speed * 0.32, 28, 60) * technicalLookahead;
  const targetProgress = projection.progress + lookAheadMetres / TRACK_LENGTH;
  const lineReference = activeReferenceTarget(trackId, targetProgress, controlGrip);
  const currentLineReference = activeReferenceTarget(trackId, projection.progress, controlGrip);
  const targetSafeLane = trackAiSafeLaneLimit(targetProgress);
  const currentSafeLane = trackAiSafeLaneLimit(projection.progress);
  const baseLane = clamp(lineReference.laneOffset, -targetSafeLane, targetSafeLane);

  // Traffic must never create a lateral target. CPU cars always steer toward
  // the shared reference line; FOLLOW only changes longitudinal pace.
  let targetLane = highFidelityLine
    ? baseLane
    : approachLane(projection.laneOffset, baseLane, 2.6);

  const offRoad = projection.distance > trackKerbOuterOffset(projection.progress) + 0.65;
  if (offRoad) {
    // Traffic never changes the normal racing line, but once an AUTO CPU is
    // genuinely off the circuit the safest recovery target is the centreline.
    // PLAYER/EDITOR traces keep their demonstrated path instead.
    targetLane = highFidelityLine
      ? clamp(currentLineReference.laneOffset, -currentSafeLane, currentSafeLane)
      : 0;
    battleState = 'CLEAR';
  }

  const explicitFollower = highFidelityLine
    ? explicitLineFollower(
        trackId,
        vehicle,
        projection.progress,
        controlGrip,
      )
    : undefined;
  if (explicitFollower) {
    targetLane = clamp(explicitFollower.targetLane, -currentSafeLane, currentSafeLane);
  }
  const steeringLookAheadMetres = explicitFollower?.lookAheadMetres ?? lookAheadMetres;
  const steeringProgress = explicitFollower?.steeringProgress
    ?? (offRoad
      ? projection.progress + 18 / TRACK_LENGTH
      : projection.progress + steeringLookAheadMetres / TRACK_LENGTH);
  const target = sampleTrack(steeringProgress, targetLane);
  const tangentDistance = highFidelityLine ? 5 : 8;
  const tangentProgress = steeringProgress + tangentDistance / TRACK_LENGTH;
  const tangentLane = offRoad
    ? 0
    : clamp(
        activeReferenceTarget(trackId, tangentProgress, controlGrip).laneOffset,
        -trackAiSafeLaneLimit(tangentProgress),
        trackAiSafeLaneLimit(tangentProgress),
      );
  const tangent = sampleTrack(tangentProgress, tangentLane);
  const pathHeading = Math.atan2(tangent.y - target.y, tangent.x - target.x);
  const bearingHeading = Math.atan2(target.y - vehicle.y, target.x - vehicle.x);
  const headingError = wrapAngle(pathHeading - vehicle.heading);
  const bearingError = wrapAngle(bearingHeading - vehicle.heading);
  const referenceLaneNow = explicitFollower
    ? clamp(explicitFollower.referenceLane, -currentSafeLane, currentSafeLane)
    : offRoad
      ? 0
      : clamp(
          currentLineReference.laneOffset,
          -currentSafeLane,
          currentSafeLane,
        );
  const lateralError = clamp((referenceLaneNow - projection.laneOffset) / 9.0, -1, 1);
  const steerCommand = offRoad
    ? bearingError * 3.25 + lateralError * 1.20 - vehicle.yawRate * 0.25
    : highFidelityLine
      ? headingError * 2.45
        + bearingError * 1.05
        + lateralError * 0.82
        - vehicle.yawRate * 0.42
      : headingError * 2.15
        + bearingError * 0.82
        + lateralError * 0.52
        - vehicle.yawRate * 0.38;
  const baselineSteer = explicitFollower
    ? explicitFollower.steer
    : clamp(steerCommand, offRoad ? -1 : -0.98, offRoad ? 1 : 0.98);
  const pitwallPrediction = !offRoad && !highFidelityLine && trackId === 'pitwall-gp'
    ? pitwallPredictionWeight(projection.progress, profile.severity)
    : 0;
  const predictionWeight = pitwallPrediction;
  const explicitPredictedSteer = explicitFollower && !explicitFollower.demonstratedDynamics
    ? predictiveExplicitLineSteer(
        trackId,
        vehicle,
        driver.tire.grip,
        explicitFollower.pathProgress,
        baselineSteer,
      )
    : undefined;
  const steer = explicitFollower
    ? explicitFollower.demonstratedDynamics
      ? baselineSteer
      : constrainedExplicitPrediction(
          explicitFollower.laneError,
          baselineSteer,
          explicitPredictedSteer ?? baselineSteer,
        )
    : predictiveAiSteer(
        vehicle,
        driver.tire.grip,
        target,
        tangent,
        baselineSteer,
        predictionWeight,
      );

  const absolutePoseTrace = lineAsset?.points.length
    ? lineAsset.points.every((point) =>
        point.worldX !== undefined
        && point.worldY !== undefined
        && point.bodyHeading !== undefined
      )
    : false;
  const longitudinalProgress = highFidelityLine && absolutePoseTrace && explicitFollower
    ? explicitFollower.pathProgress
    : projection.progress;
  const speedReference = highFidelityLine
    ? activeReferenceTarget(trackId, longitudinalProgress, controlGrip)
    : currentLineReference;
  const longitudinalSample = highFidelityLine && lineAsset
    ? sampleRacingLineAsset(lineAsset, longitudinalProgress)
    : undefined;
  const longitudinalSourceGrip = longitudinalSample?.tireGrip
    ?? lineAsset?.referenceGrip
    ?? driver.tire.grip;
  const hasForwardAccelerationTrace =
    longitudinalSample?.forwardAcceleration !== undefined;
  // PLAYER/EDITOR is a best-lap reference, not a metronome. Race CPUs request
  // slightly less than the demonstrated pace most of the time, with a smooth
  // driver-specific form/consistency wave. Hardware, tyres, tow and braking
  // phase can still make the physical result faster than the recorded lap.
  const liveExecution = driverPerformance?.executionFactor ?? 1;
  const nominalTargetSpeed = speedReference.targetSpeed
    * (
      referenceGhost
        ? 1
        : highFidelityLine
          ? liveExecution
          : paceCheat * liveExecution
    );
  let targetSpeed = nominalTargetSpeed;
  let cornerAttackConfidence = 0;

  if (highFidelityLine && (battleState === 'CLEAR' || battleState === 'FOLLOW')) {
    // Preserve the normal signed-lane recovery that keeps small tracking errors
    // damped, but add a second physical-distance guard for true departures.
    // Far from the path, the nearest segment can rotate enough that signed lane
    // error looks deceptively small (the human report showed ~30 m PATH ERROR
    // with only ~1.6 m lane error), so either signal may demand a slowdown.
    const laneError = explicitFollower
      ? Math.abs(explicitFollower.laneError)
      : Math.abs(referenceLaneNow - projection.laneOffset);
    const pathError = explicitFollower?.pathError ?? laneError;
    // A demonstrated Q5/AXF trace is already a physically proven path. Small
    // spatial replay error should be corrected primarily by steering, not by
    // deleting 10-20% of the demonstrated speed. The old 2.4/3.0 m thresholds
    // made a ~3.5 m miss at the lap seam trigger immediate feedback braking,
    // turning a positive source AXF into a large negative acceleration.
    // Keep strong slowdown for genuine departures, but let ordinary Q5
    // convergence happen at the demonstrated longitudinal pace.
    const gripTransferred =
      Math.abs(driver.tire.grip - longitudinalSourceGrip) > 0.08;
    // A demonstrated body/yaw trace is already a physically observed path.
    // Small replay error should be corrected by steering rather than deleting
    // longitudinal pace. Reserve the aggressive speed cap for legacy lines
    // that do not carry demonstrated dynamics, or for a genuine departure.
    const demonstratedPathDynamics =
      explicitFollower?.demonstratedDynamics ?? false;
    const normalRecoveryScale = demonstratedPathDynamics
      ? 1 - clamp((laneError - 5.0) / 5.0, 0, 1) * 0.30
      : gripTransferred
        ? 1 - clamp((laneError - 2.6) / 5.4, 0, 1) * 0.38
        : 1 - clamp((laneError - 0.9) / 4.8, 0, 1) * 0.62;
    const emergencyPathScale = demonstratedPathDynamics
      ? 1 - clamp((pathError - 8.0) / 6.0, 0, 1) * 0.55
      : gripTransferred
        ? 1 - clamp((pathError - 5.5) / 5.5, 0, 1) * 0.48
        : 1 - clamp((pathError - 3.0) / 2.5, 0, 1) * 0.62;
    targetSpeed *= Math.min(normalRecoveryScale, emergencyPathScale);
  }

  // The generated AUTO reference is intentionally conservative about transient
  // rotation. Once the real car is demonstrably on that machine line, allow a small
  // speed carry through the same two complexes. The better predictive follower
  // now has enough line margin to use more of the physical chassis while poor
  // tracking still removes the allowance before it can become a cut.
  // This progress window belongs to the extended STANDARD layout; the compact
  // layout must use its physical reference speed without this extra allowance.
  // PLAYER/EDITOR line is already physically demonstrated and must not receive
  // this extra speed injection.
  if (!highFidelityLine && battleState === 'CLEAR' && !offRoad
    && trackId === 'pitwall-gp' && getActiveTrack().scalePreset === 'STANDARD') {
    const lineError = Math.abs(referenceLaneNow - projection.laneOffset);
    const lineConfidence = 1 - clamp(lineError / 7.0, 0, 1);
    const technical = clamp((profile.severity - 0.16) / 0.76, 0, 1);
    const attackWindow = pitwallAttackWindow(projection.progress);
    cornerAttackConfidence = attackWindow * technical * lineConfidence;
    targetSpeed *= 1 + cornerAttackConfidence * 0.09;
  }

  if (laneBlocked && ahead) {
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

  if (projection.distance > trackKerbOuterOffset(projection.progress) + 0.65) targetSpeed = Math.min(targetSpeed, 58);
  if (projection.distance >= trackRunoffHalfWidth(projection.progress)) targetSpeed = Math.min(targetSpeed, 36);
  targetSpeed = clamp(targetSpeed, highFidelityLine ? 18 : 26, 136);

  const speedError = targetSpeed - speed;
  const recoverySpeedLimited = targetSpeed < nominalTargetSpeed - 0.1;
  const feedbackSpeedTarget = hasForwardAccelerationTrace && !recoverySpeedLimited
    ? nominalTargetSpeed
    : targetSpeed;
  const overspeed = speed - feedbackSpeedTarget;
  // When the predictive follower is securely on the line, do not immediately
  // erase a few km/h of legitimate chicane carry with the generic speed-loop
  // deadband. This only changes braking decisions; grip and propulsion remain
  // the shared physical car. Any growing lane error collapses the allowance.
  const demonstratedSpeedTrace = explicitFollower?.demonstratedDynamics ?? false;
  const feedbackBrakeThreshold = hasForwardAccelerationTrace
    ? 4.0
    : demonstratedSpeedTrace
      ? 0.22
      : 0.65 + cornerAttackConfidence * 1.5;
  const feedbackBrakeDivisor = hasForwardAccelerationTrace
    ? 9.5
    : demonstratedSpeedTrace
      ? 5.1
      : 9.4;
  const feedbackBrakeBias = hasForwardAccelerationTrace
    ? 0
    : demonstratedSpeedTrace
      ? 0.22
      : 0.45;
  const feedbackBrake = overspeed > feedbackBrakeThreshold
    ? clamp(
        (overspeed - feedbackBrakeThreshold + feedbackBrakeBias)
          / feedbackBrakeDivisor,
        0.05,
        1,
      )
    : 0;
  // Measured forward acceleration is an authoritative braking phase and must
  // remain anchored to path position even when replay arrives underspeed.
  // A legacy speed-derived brake phase is only an estimate, so let it yield
  // when the car is already below the demonstrated target instead of compounding
  // the deficit for the rest of the lap.
  const plannedBrakeWeight = hasForwardAccelerationTrace
    ? 1
    : highFidelityLine && !(explicitFollower?.demonstratedDynamics ?? false)
      ? 1
      : clamp((1.15 - speedError) / 2.3, 0, 1);
  const plannedBrakeScale = 0.82 - cornerAttackConfidence * 0.16;
  const explicitProfileBrake = highFidelityLine
    ? explicitFollower?.demonstratedDynamics
      ? racingLineLocalBrakeIntent(
          trackId,
          longitudinalProgress,
          controlGrip,
          speed,
          steer,
        )
      : racingLineBrakeIntent(
          trackId,
          longitudinalProgress,
          controlGrip,
          speed,
        )
    : 0;
  let brake = highFidelityLine
    ? Math.max(
        feedbackBrake,
        explicitProfileBrake * plannedBrakeWeight,
      )
    : Math.max(feedbackBrake, speedReference.brake * plannedBrakeScale * plannedBrakeWeight);

  const explicitProfileThrottle = highFidelityLine
    ? racingLineThrottleIntent(
        trackId,
        longitudinalProgress,
        controlGrip,
        speed,
        steer,
      )
    : 0;

  let throttle: number;
  if (brake > 0.06) {
    throttle = 0;
  } else if (highFidelityLine) {
    if (speedError > 2.0) {
      throttle = 1;
    } else {
      throttle = clamp(
        explicitProfileThrottle + speedError * 0.20,
        0,
        1,
      );
    }
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

  // A demonstrated racing line can legitimately contain full-brake samples at
  // this phase. If a CPU has been knocked almost to a halt, replaying that
  // sample forever creates a deadlock: progress no longer advances, therefore
  // the controller never leaves the braking phase. At very low speed, when the
  // requested pace is clearly much faster, temporarily prioritise getting the
  // car rolling and steering back toward the path. Normal recorded braking
  // resumes once it is moving fast enough to advance through the phase.
  const lowSpeedRecovery =
    speed < 14
    && targetSpeed - speed > 12
    && !referenceGhost;
  if (lowSpeedRecovery) {
    brake = 0;
    const alignment = 1 - clamp(Math.abs(bearingError) / (Math.PI * 0.75), 0, 1);
    throttle = Math.max(
      throttle,
      0.44 + alignment * 0.34,
    );
  }

  return {
    throttle,
    brake,
    steer,
    targetSpeed,
    targetLane,
    battleState,
    debug: {
      lineSource: lineAsset?.source ?? 'AUTO',
      progress: explicitFollower?.pathProgress ?? projection.progress,
      centerProgress: projection.progress,
      referenceLane: referenceLaneNow,
      laneError: explicitFollower
        ? -explicitFollower.laneError
        : projection.laneOffset - referenceLaneNow,
      pathError: explicitFollower?.pathError
        ?? Math.abs(projection.laneOffset - referenceLaneNow),
      lookAheadMetres: steeringLookAheadMetres,
      steeringProgress: wrap01(steeringProgress),
      predictionWeight,
      feedbackBrake,
      profileBrake: explicitProfileBrake,
      profileThrottle: explicitProfileThrottle,
      demonstratedDynamics: explicitFollower?.demonstratedDynamics ?? false,
      demonstratedAcceleration: lineAsset?.points.some(
        (point) => point.longitudinalAcceleration !== undefined,
      ) ?? false,
      demonstratedGripTrace: lineAsset?.points.some(
        (point) => point.tireGrip !== undefined,
      ) ?? false,
      demonstratedForwardAcceleration: lineAsset?.points.some(
        (point) => point.forwardAcceleration !== undefined,
      ) ?? false,
      sourceGrip: lineAsset
        ? longitudinalSourceGrip
        : undefined,
      sourceForwardAcceleration: longitudinalSample?.forwardAcceleration,
      sourceNetSpeedAcceleration: longitudinalSample?.longitudinalAcceleration,
      targetYawRate: explicitFollower?.targetYawRate,
      pathHeadingError: explicitFollower?.pathHeadingError ?? headingError,
      bearingError: explicitFollower?.bearingError ?? bearingError,
      driverExecutionFactor: liveExecution,
    },
  };
}

function constrainedExplicitPrediction(
  laneError: number,
  baselineSteer: number,
  predictedSteer: number,
): number {
  const magnitude = Math.abs(laneError);
  if (magnitude < 1.8) return predictedSteer;

  const recoveryDirection = Math.sign(laneError);
  const predictedOpposesRecovery = predictedSteer * recoveryDirection < -0.015;
  if (predictedOpposesRecovery) {
    // Once the car is materially displaced, do not sacrifice the current path
    // in order to prepare an even later apex. That was the remaining failure
    // mode in compact S-bends: MPC could choose the next turn while the car was
    // still several metres on the wrong side of the present line.
    return baselineSteer;
  }

  if (magnitude >= 4.5) return baselineSteer;

  const predictionWeight = 1 - clamp((magnitude - 1.8) / 2.7, 0, 1);
  return clamp(
    baselineSteer * (1 - predictionWeight)
      + predictedSteer * predictionWeight,
    -1,
    1,
  );
}

function pitwallPredictionWeight(progress: number, severity: number): number {
  const technical = clamp((severity - 0.18) / 0.74, 0, 1);
  const middle = windowWeight(wrap01(progress), 0.50, 0.68, 0.035);
  const final = finalComplexWeight(progress);
  return technical * Math.max(middle * 0.32, final * 0.34);
}

function pitwallAttackWindow(progress: number): number {
  const p = wrap01(progress);
  const middle = windowWeight(p, 0.49, 0.70, 0.040);
  const final = finalComplexWeight(p);
  return Math.max(middle, final);
}

function finalComplexWeight(progress: number): number {
  const p = wrap01(progress);
  return Math.max(
    windowWeight(p, 0.835, 0.998, 0.030),
    windowWeight(p, 0.000, 0.045, 0.022),
  );
}

function windowWeight(progress: number, start: number, end: number, feather: number): number {
  if (progress >= start && progress <= end) return 1;
  if (progress >= start - feather && progress < start) {
    return smoothstep((progress - (start - feather)) / feather);
  }
  if (progress > end && progress <= end + feather) {
    return 1 - smoothstep((progress - end) / feather);
  }
  return 0;
}

function smoothstep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

function approachLane(current: number, desired: number, maximumDelta: number): number {
  return clamp(desired, current - maximumDelta, current + maximumDelta);
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
