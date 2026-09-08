export interface SurfaceEffect {
  severity: number;
  gripMultiplier: number;
  powerMultiplier: number;
  rollingResistance: number;
  label: 'TRACK' | 'RUNOFF' | 'GRASS';
}

/**
 * The physical road is intentionally narrow. A wheel-width mistake is allowed,
 * but using the grey runoff as extra race track immediately costs speed and grip.
 *
 * Full grass must still be driveable at low speed. The previous values removed
 * so much power and added so much rolling resistance that a slowed car could no
 * longer accelerate at all, effectively turning any excursion into a soft lock.
 */
export function surfaceEffect(distanceFromLine: number): SurfaceEffect {
  const edge = 29;
  const severity = clamp01((Math.max(0, distanceFromLine) - edge) / 28);
  const label: SurfaceEffect['label'] = severity <= 0 ? 'TRACK' : severity < 0.45 ? 'RUNOFF' : 'GRASS';

  return {
    severity,
    gripMultiplier: 1 - severity * 0.42,
    powerMultiplier: 1 - severity * 0.26,
    rollingResistance: severity * 4.8,
    label,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
