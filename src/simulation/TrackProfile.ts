import { trackAiSafeLaneLimit } from './TrackLimitsModel';
import { raceScaleDistance, sampleTrack, TRACK_LENGTH } from './TrackModel';

export interface TrackProfileSample {
  signedTurn: number;
  severity: number;
  targetSpeed: number;
  apexOffset: number;
}

function metresToProgress(metres: number): number {
  return raceScaleDistance(metres) / TRACK_LENGTH;
}

export function trackProfile(progress: number, skill = 1, grip = 1): TrackProfileSample {
  const here = signedHeadingDelta(progress - metresToProgress(22), progress + metresToProgress(22));
  const near = signedHeadingDelta(progress + metresToProgress(34), progress + metresToProgress(98));
  const far = signedHeadingDelta(progress + metresToProgress(98), progress + metresToProgress(190));

  const severity = clamp01(Math.max(
    Math.abs(here) / 0.31,
    Math.abs(near) / 0.40 * 0.98,
    Math.abs(far) / 0.48 * 0.82,
  ));

  const safeSkill = clamp(skill, 0.94, 1.24);
  const safeGrip = clamp(grip, 0.38, 1.34);
  const straightSpeed = 112 + (safeSkill - 0.94) * 39;

  // Keep Medium near the safe miniature-circuit baseline while preserving a
  // clear S/M/H hierarchy in corners. Straight speed remains compound-neutral.
  const baseCornerFloor = 42 + (safeSkill - 0.94) * 44;
  const cornerGrip = clamp01((safeGrip - 0.55) / 0.79);
  const cornerGripFactor = 0.64 + cornerGrip * 0.59;
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
    : Math.sign(signedTurn) * Math.min(
        trackAiSafeLaneLimit(progress) * 0.95,
        (3.4 + severity * 5.0) * apexReach,
      );

  return { signedTurn, severity, targetSpeed, apexOffset };
}

export function racingLineOffset(progress: number, grip = 1): number {
  const step = metresToProgress(12);
  const weights = [1, 2, 3, 4, 3, 2, 1] as const;
  let weighted = 0;
  let totalWeight = 0;

  for (let index = 0; index < weights.length; index++) {
    const sampleOffset = index - 3;
    const weight = weights[index];
    weighted += rawRacingLineOffset(progress + sampleOffset * step, grip) * weight;
    totalWeight += weight;
  }

  const safeLane = trackAiSafeLaneLimit(progress);
  return clamp(weighted / totalWeight, -safeLane, safeLane);
}

function rawRacingLineOffset(progress: number, grip: number): number {
  const localTurn = signedHeadingDelta(progress - metresToProgress(18), progress + metresToProgress(18));
  const approachingTurn = signedHeadingDelta(progress + metresToProgress(24), progress + metresToProgress(102));
  const exitingTurn = signedHeadingDelta(progress - metresToProgress(102), progress - metresToProgress(24));

  const localStrength = clamp01(Math.abs(localTurn) / 0.28);
  const approachStrength = clamp01(Math.abs(approachingTurn) / 0.42);
  const exitStrength = clamp01(Math.abs(exitingTurn) / 0.42);
  const gripReach = 0.82 + clamp01((grip - 0.76) / 0.46) * 0.18;

  const apexWeight = smoothstep01((localStrength - 0.12) / 0.70);
  const approachWeight = smoothstep01((approachStrength - 0.14) / 0.66) * (1 - apexWeight * 0.78);
  const exitWeight = smoothstep01((exitStrength - 0.16) / 0.64) * (1 - apexWeight * 0.84);

  const apexTarget = Math.abs(localTurn) < 0.018
    ? 0
    : Math.sign(localTurn) * (3.2 + localStrength * 4.6) * gripReach;
  const approachTarget = Math.abs(approachingTurn) < 0.022
    ? 0
    : -Math.sign(approachingTurn) * (2.6 + approachStrength * 3.6);
  const exitTarget = Math.abs(exitingTurn) < 0.022
    ? 0
    : -Math.sign(exitingTurn) * (2.3 + exitStrength * 3.2);

  const weightSum = apexWeight + approachWeight + exitWeight;
  if (weightSum < 0.02) return 0;

  return (
    apexTarget * apexWeight
    + approachTarget * approachWeight
    + exitTarget * exitWeight
  ) / Math.max(1, weightSum);
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

function smoothstep01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
