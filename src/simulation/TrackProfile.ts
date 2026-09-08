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
 * AI pace profile derived from the authoritative spline. Compound grip is a
 * first-class pace input: a fresh Soft should carry obviously more speed in a
 * bend than a Medium, while a Hard or worn tyre has to brake earlier.
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
  const safeGrip = clamp(grip, 0.30, 1.42);

  const straightSpeed = 112 + (safeSkill - 0.94) * 39;
  const baseCornerFloor = 45 + (safeSkill - 0.94) * 62;
  // Exaggerated by design: 1.3+ grip becomes a qualifying-lap weapon, while
  // sub-0.8 grip gives away a huge amount in technical sectors.
  const cornerGripFactor = clamp(Math.pow(safeGrip, 2.12), 0.34, 1.82);
  const cornerFloor = baseCornerFloor * cornerGripFactor;
  const targetSpeed = clamp(
    straightSpeed - severity * (straightSpeed - cornerFloor),
    24,
    124,
  );

  const signedTurn = here * 0.62 + near * 0.38;
  const apexOffset = Math.abs(signedTurn) < 0.03
    ? 0
    : Math.sign(signedTurn) * Math.min(14, 5 + severity * 9);

  return { signedTurn, severity, targetSpeed, apexOffset };
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
