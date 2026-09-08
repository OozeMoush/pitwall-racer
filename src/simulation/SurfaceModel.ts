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
 */
export function surfaceEffect(distanceFromLine: number): SurfaceEffect {
  const edge = 29;
  const severity = clamp01((Math.max(0, distanceFromLine) - edge) / 28);
  const label: SurfaceEffect['label'] = severity <= 0 ? 'TRACK' : severity < 0.45 ? 'RUNOFF' : 'GRASS';

  return {
    severity,
    gripMultiplier: 1 - severity * 0.5,
    powerMultiplier: 1 - severity * 0.64,
    rollingResistance: severity * 13,
    label,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
