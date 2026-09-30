import {
  DEEP_CUT_DISTANCE,
  FREE_KERB_DISTANCE,
  TRACK_RUNOFF_HALF_WIDTH,
  trackDeepCutDistance,
  trackFreeKerbDistance,
  trackRunoffHalfWidth,
} from './TrackLimitsModel';

export interface SurfaceEffect {
  severity: number;
  gripMultiplier: number;
  powerMultiplier: number;
  rollingResistance: number;
  label: 'TRACK' | 'RUNOFF' | 'GRASS';
}

const DEEP_KERB_SEVERITY = 0.50;
const RUNOFF_EDGE_SEVERITY = 0.78;

/**
 * One-side kerb use is free, a four-wheel cut costs time, and grass is now a
 * decisive high-speed penalty. The grass values are still deliberately speed
 * dependent through ArcadeCarController, so a nearly stopped car can drive
 * back to the road instead of getting soft-locked.
 */
export function surfaceEffect(
  distanceFromLine: number,
  progress?: number,
): SurfaceEffect {
  const distance = Math.max(0, distanceFromLine);
  const freeKerb = progress === undefined
    ? FREE_KERB_DISTANCE
    : trackFreeKerbDistance(progress);
  const deepCut = progress === undefined
    ? DEEP_CUT_DISTANCE
    : trackDeepCutDistance(progress);
  const runoff = progress === undefined
    ? TRACK_RUNOFF_HALF_WIDTH
    : trackRunoffHalfWidth(progress);
  let severity = 0;

  if (distance > freeKerb && distance <= deepCut) {
    severity = DEEP_KERB_SEVERITY
      * clamp01((distance - freeKerb) / Math.max(0.001, deepCut - freeKerb));
  } else if (distance > deepCut && distance < runoff) {
    severity = DEEP_KERB_SEVERITY
      + (RUNOFF_EDGE_SEVERITY - DEEP_KERB_SEVERITY)
        * clamp01((distance - deepCut) / Math.max(0.001, runoff - deepCut));
  } else if (distance >= runoff) {
    severity = 1;
  }

  const label: SurfaceEffect['label'] = severity <= 0
    ? 'TRACK'
    : distance < runoff
      ? 'RUNOFF'
      : 'GRASS';

  return {
    severity,
    gripMultiplier: 1 - severity * 0.55,
    powerMultiplier: 1 - severity * 0.38,
    rollingResistance: severity * 4.2,
    label,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
