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
 * Lightweight AI profile from the authoritative spline. Compound grip now
 * changes corner speed strongly but barely touches straight-line speed, so a
 * Soft AI visibly gains time in bends instead of just carrying a coloured tyre.
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

  const safeSkill = clamp(skill, 0.9, 1.13);
  const safeGrip = clamp(grip, 0.48, 1.22);

  const straightSpeed = 110 + (safeSkill - 0.9) * 34;
  const baseCornerFloor = 44 + (safeSkill - 0.9) * 46;
  // 1.20 grip -> ~35% more corner capability than a fresh Medium; 0.84 grip
  // gives up a lot. Straight speed remains almost identical.
  const cornerGripFactor = clamp(Math.pow(safeGrip, 1.7), 0.58, 1.36);
  const cornerFloor = baseCornerFloor * cornerGripFactor;
  const targetSpeed = clamp(
    straightSpeed - severity * (straightSpeed - cornerFloor),
    30,
    118,
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
