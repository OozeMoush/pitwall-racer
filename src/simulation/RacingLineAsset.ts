import type { TrackId } from './TrackModel';

export type RacingLineSource = 'AUTO' | 'PLAYER' | 'EDITOR' | 'OPTIMIZER';

export interface RacingLinePoint {
  progress: number;
  laneOffset: number;
  targetSpeed: number;
  /**
   * Demonstrated body heading relative to the circuit centreline tangent.
   * Optional for backward compatibility with legacy PLAYER assets.
   */
  headingOffset?: number;
  /**
   * Demonstrated body yaw rate in radians/second. This is vehicle state, not
   * copied steering input, and lets an explicit-line follower reproduce the
   * rotation timing of a physically proven lap.
   */
  yawRate?: number;
  /**
   * Demonstrated scalar speed acceleration (dv/dt) in m/s². This is vehicle
   * state, not pedal input. It preserves the longitudinal timing of a proven
   * lap without assuming centreline metres equal travelled path metres.
   */
  longitudinalAcceleration?: number;
}

export interface RacingLineAsset {
  version: 1;
  trackId: TrackId;
  source: RacingLineSource;
  referenceGrip?: number;
  lapSeconds?: number;
  points: readonly RacingLinePoint[];
}

export function sampleRacingLineAsset(
  asset: RacingLineAsset,
  progress: number,
): RacingLinePoint {
  if (asset.points.length === 0) {
    return { progress: wrap01(progress), laneOffset: 0, targetSpeed: 0 };
  }

  const p = wrap01(progress);
  const scaled = p * asset.points.length;
  const index = Math.floor(scaled) % asset.points.length;
  const nextIndex = (index + 1) % asset.points.length;
  const t = scaled - Math.floor(scaled);
  const a = asset.points[index];
  const b = asset.points[nextIndex];

  return {
    progress: p,
    laneOffset: lerp(a.laneOffset, b.laneOffset, t),
    targetSpeed: lerp(a.targetSpeed, b.targetSpeed, t),
    headingOffset: interpolateOptionalAngle(a.headingOffset, b.headingOffset, t),
    yawRate: interpolateOptional(a.yawRate, b.yawRate, t),
    longitudinalAcceleration: interpolateOptional(
      a.longitudinalAcceleration,
      b.longitudinalAcceleration,
      t,
    ),
  };
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

function interpolateOptional(
  a: number | undefined,
  b: number | undefined,
  t: number,
): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined) return b;
  if (b === undefined) return a;
  return lerp(a, b, t);
}

function interpolateOptionalAngle(
  a: number | undefined,
  b: number | undefined,
  t: number,
): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined) return b;
  if (b === undefined) return a;
  return wrapAngle(a + wrapAngle(b - a) * t);
}

function wrapAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
