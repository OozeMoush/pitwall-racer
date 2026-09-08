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
 * Lightweight AI driving profile derived from the authoritative spline.
 * Look-ahead windows are expressed in track distance, not percentages of the
 * lap, so enlarging the circuit does not accidentally make the AI inspect half
 * a sector at once. This creates readable braking zones on long straights.
 */
export function trackProfile(progress: number, skill = 1, grip = 1): TrackProfileSample {
  const here = signedHeadingDelta(progress - metresToProgress(24), progress + metresToProgress(24));
  const near = signedHeadingDelta(progress + metresToProgress(38), progress + metresToProgress(105));
  const far = signedHeadingDelta(progress + metresToProgress(105), progress + metresToProgress(205));

  const severity = clamp01(
    Math.max(
      Math.abs(here) / 0.33,
      Math.abs(near) / 0.42 * 0.96,
      Math.abs(far) / 0.5 * 0.8,
    ),
  );

  const safeSkill = clamp(skill, 0.9, 1.12);
  const safeGrip = clamp(grip, 0.62, 1.12);

  // NORMAL player power should be raceable but not enough to simply drive away.
  // Quick AI approaches DEPLOY pace on straights and still has to give away a
  // lot of speed in real braking zones.
  const straightSpeed = 109 + (safeSkill - 0.9) * 32;
  const cornerFloor = 43 + (safeSkill - 0.9) * 45;
  const gripFactor = 0.77 + safeGrip * 0.23;
  const targetSpeed = clamp((straightSpeed - severity * (straightSpeed - cornerFloor)) * gripFactor, 40, 116);

  const signedTurn = here * 0.6 + near * 0.4;
  const apexOffset = Math.abs(signedTurn) < 0.03
    ? 0
    : Math.sign(signedTurn) * Math.min(22, 7 + severity * 15);

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
