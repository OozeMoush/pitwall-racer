import {
  DEEP_CUT_DISTANCE,
  FREE_KERB_DISTANCE,
  FULL_GRASS_DISTANCE,
  TRACK_RUNOFF_HALF_WIDTH,
} from './TrackLimitsModel';

export interface SurfaceEffect {
  severity: number;
  gripMultiplier: number;
  powerMultiplier: number;
  rollingResistance: number;
  label: 'TRACK' | 'RUNOFF' | 'GRASS';
}

const DEEP_KERB_SEVERITY = 0.50;

/**
 * The visible road is deliberately much narrower than the original arcade
 * prototype. One-side kerb use remains free, but once the car centre moves far
 * enough out that the whole car is effectively beyond the white line, the
 * penalty rises quickly. Runoff and grass then make a shortcut slower than
 * staying on the circuit while still allowing a low-speed recovery.
 */
export function surfaceEffect(distanceFromLine: number): SurfaceEffect {
  const distance = Math.max(0, distanceFromLine);
  let severity = 0;

  if (distance > FREE_KERB_DISTANCE && distance <= DEEP_CUT_DISTANCE) {
    severity = DEEP_KERB_SEVERITY
      * clamp01((distance - FREE_KERB_DISTANCE) / (DEEP_CUT_DISTANCE - FREE_KERB_DISTANCE));
  } else if (distance > DEEP_CUT_DISTANCE) {
    severity = DEEP_KERB_SEVERITY
      + (1 - DEEP_KERB_SEVERITY)
        * clamp01((distance - DEEP_CUT_DISTANCE) / (FULL_GRASS_DISTANCE - DEEP_CUT_DISTANCE));
  }

  const label: SurfaceEffect['label'] = severity <= 0
    ? 'TRACK'
    : distance < TRACK_RUNOFF_HALF_WIDTH
      ? 'RUNOFF'
      : 'GRASS';

  return {
    severity,
    gripMultiplier: 1 - severity * 0.50,
    powerMultiplier: 1 - severity * 0.28,
    rollingResistance: severity * 2.6,
    label,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
