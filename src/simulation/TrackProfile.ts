import { sampleTrack, TRACK_LENGTH } from './TrackModel';

export interface TrackProfileSample {
  signedTurn: number;
  severity: number;
  targetSpeed: number;
  apexOffset: number;
}

const SAMPLE_DELTA = 0.008;

/**
 * Lightweight driving profile derived directly from the authoritative spline.
 * It intentionally gives AI enough knowledge to brake and choose a corner line
 * without turning the field into full vehicle-physics simulations.
 */
export function trackProfile(progress: number, skill = 1, grip = 1): TrackProfileSample {
  const here = signedHeadingDelta(progress - SAMPLE_DELTA, progress + SAMPLE_DELTA);
  const near = signedHeadingDelta(progress + 0.012, progress + 0.03);
  const far = signedHeadingDelta(progress + 0.03, progress + 0.055);

  // Looking ahead is what makes the AI brake before the corner instead of only
  // reacting after it is already rotating through the apex.
  const severity = clamp01(
    Math.max(
      Math.abs(here) / 0.42,
      Math.abs(near) / 0.36 * 0.94,
      Math.abs(far) / 0.34 * 0.82,
    ),
  );

  const safeSkill = clamp(skill, 0.9, 1.12);
  const safeGrip = clamp(grip, 0.62, 1.12);
  const straightSpeed = 106 * (0.98 + (safeSkill - 1) * 0.7);
  const cornerFloor = 47 + (safeSkill - 0.9) * 31;
  const gripFactor = 0.82 + safeGrip * 0.18;
  const targetSpeed = clamp((straightSpeed - severity * (straightSpeed - cornerFloor)) * gripFactor, 42, 111);

  // Positive signed turn is a left corner; positive track offset is also left
  // of the spline tangent. Moving modestly toward that side gives a visible
  // apex line while still leaving room for attack/defence offsets.
  const signedTurn = here * 0.65 + near * 0.35;
  const apexOffset = Math.abs(signedTurn) < 0.035 ? 0 : Math.sign(signedTurn) * Math.min(15, 5 + severity * 10);

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
