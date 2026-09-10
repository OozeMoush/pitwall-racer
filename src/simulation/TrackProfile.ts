import { AI_SAFE_LANE_LIMIT } from './TrackLimitsModel';
import { sampleTrack, TRACK_LENGTH } from './TrackModel';

export interface TrackProfileSample {
  signedTurn: number;
  severity: number;
  targetSpeed: number;
  apexOffset: number;
}

function metresToProgress(metres: number): number {
  return metres / TRACK_LENGTH;
}

/**
 * AI pace profile derived from the authoritative spline.
 *
 * Tyres change how aggressively a car can attack a corner, not how much engine
 * power it has on a straight. Fresh Soft rubber brakes later, carries more apex
 * speed and reaches further toward the apex. Hard rubber takes a calmer line
 * but should still arrive at the next braking zone with comparable speed.
 */
export function trackProfile(progress: number, skill = 1, grip = 1): TrackProfileSample {
  const here = signedHeadingDelta(progress - metresToProgress(22), progress + metresToProgress(22));
  const near = signedHeadingDelta(progress + metresToProgress(34), progress + metresToProgress(98));
  const far = signedHeadingDelta(progress + metresToProgress(98), progress + metresToProgress(190));

  const severity = clamp01(
    Math.max(
      Math.abs(here) / 0.31,
      Math.abs(near) / 0.40 * 0.98,
      Math.abs(far) / 0.48 * 0.82,
    ),
  );

  const safeSkill = clamp(skill, 0.94, 1.24);
  const safeGrip = clamp(grip, 0.38, 1.34);

  // Straight speed intentionally has no compound term. Driver skill can still
  // create a small pace spread, but S/M/H should not behave like engine modes.
  const straightSpeed = 112 + (safeSkill - 0.94) * 39;
  const baseCornerFloor = 46 + (safeSkill - 0.94) * 58;
  const cornerGripFactor = clamp(Math.pow(safeGrip, 1.58), 0.52, 1.50);
  const cornerFloor = baseCornerFloor * cornerGripFactor;
  const targetSpeed = clamp(
    straightSpeed - severity * (straightSpeed - cornerFloor),
    28,
    124,
  );

  const signedTurn = here * 0.62 + near * 0.38;
  const lineGrip = clamp01((safeGrip - 0.55) / 0.78);
  const apexReach = 0.74 + lineGrip * 0.34;
  const apexOffset = Math.abs(signedTurn) < 0.03
    ? 0
    : Math.sign(signedTurn) * Math.min(12.2, (4.4 + severity * 7.0) * apexReach);

  return { signedTurn, severity, targetSpeed, apexOffset };
}

/**
 * A real racing line needs more than "aim at the inside". This helper gives the
 * physical AI three readable phases: move to the outside before a corner, clip
 * the inside near the local curvature peak, then use the outside again on exit.
 * The result is intentionally bounded by the car-centre safe lane limit.
 */
export function racingLineOffset(progress: number, grip = 1): number {
  const localTurn = signedHeadingDelta(progress - metresToProgress(18), progress + metresToProgress(18));
  const approachingTurn = signedHeadingDelta(progress + metresToProgress(24), progress + metresToProgress(102));
  const exitingTurn = signedHeadingDelta(progress - metresToProgress(102), progress - metresToProgress(24));

  const localStrength = clamp01(Math.abs(localTurn) / 0.28);
  const approachStrength = clamp01(Math.abs(approachingTurn) / 0.42);
  const exitStrength = clamp01(Math.abs(exitingTurn) / 0.42);
  const gripReach = 0.82 + clamp01((grip - 0.76) / 0.46) * 0.18;

  let offset = 0;
  if (localStrength > 0.24 && Math.abs(localTurn) > 0.025) {
    offset = Math.sign(localTurn) * (4.6 + localStrength * 6.9) * gripReach;
  } else if (approachStrength > 0.22 && Math.abs(approachingTurn) > 0.028) {
    offset = -Math.sign(approachingTurn) * (3.8 + approachStrength * 5.8);
  } else if (exitStrength > 0.24 && Math.abs(exitingTurn) > 0.028) {
    offset = -Math.sign(exitingTurn) * (3.4 + exitStrength * 5.0);
  }

  return clamp(offset, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
}

export function signedHeadingDelta(fromProgress: number, toProgress: number): number {
  const from = sampleTrack(fromProgress).heading;
  const to = sampleTrack(toProgress).heading;
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function distanceForProgress(deltaProgress: number): number {
  return Math.abs(deltaProgress) * TRACK_LENGTH;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
