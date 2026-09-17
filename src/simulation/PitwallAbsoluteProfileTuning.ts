import {
  PITWALL_ABSOLUTE_PROFILE,
  type PitwallAbsoluteProfileSample,
} from './PitwallAbsoluteProfile';

export interface PitwallAbsoluteSpeedWindow {
  /** Progress centre in [0, 1); wrapping is supported. */
  center: number;
  /** Half-width in progress units. */
  halfWidth: number;
  /** Additive target-speed delta in m/s. */
  delta: number;
}

export interface PitwallAbsoluteProfileTuning {
  /** Smooth m/s lift through the 48.5-63.5% central technical complex. */
  centralSpeedLift?: number;
  /** Smooth m/s lift through the 83.5-96.5% final technical complex. */
  finalSpeedLift?: number;
  /** Local additive speed dimensions for course-specific joint search. */
  speedWindows?: readonly PitwallAbsoluteSpeedWindow[];
}

/**
 * Materialize a tunable speed trace while keeping the measured machine-only
 * throttle/brake feed-forward controls unchanged. Search dimensions therefore
 * alter requested pace, never grip, power or chassis capability.
 */
export function materializePitwallAbsoluteProfile(
  tuning: PitwallAbsoluteProfileTuning = {},
): PitwallAbsoluteProfileSample[] {
  const centralSpeedLift = tuning.centralSpeedLift ?? 0;
  const finalSpeedLift = tuning.finalSpeedLift ?? 0;
  const speedWindows = tuning.speedWindows ?? [];

  return PITWALL_ABSOLUTE_PROFILE.map((sample, index) => {
    const progress = index / PITWALL_ABSOLUTE_PROFILE.length;
    const centralWeight = windowWeight(progress, 0.485, 0.635, 0.035);
    const finalWeight = windowWeight(progress, 0.835, 0.965, 0.025);
    let speed = sample.speed
      + centralSpeedLift * centralWeight
      + finalSpeedLift * finalWeight;

    for (const window of speedWindows) {
      speed += window.delta * circularWindowWeight(progress, window.center, window.halfWidth);
    }

    return {
      ...sample,
      speed,
    };
  });
}

function circularWindowWeight(progress: number, center: number, halfWidth: number): number {
  if (halfWidth <= 0) return 0;
  const distance = Math.abs(circularDelta(wrap01(progress), wrap01(center)));
  if (distance >= halfWidth) return 0;
  const phase = distance / halfWidth;
  return 0.5 * (1 + Math.cos(Math.PI * phase));
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

function circularDelta(a: number, b: number): number {
  let delta = a - b;
  while (delta > 0.5) delta -= 1;
  while (delta < -0.5) delta += 1;
  return delta;
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}
