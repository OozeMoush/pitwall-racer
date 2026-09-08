export interface SurfaceEffect {
  severity: number;
  gripMultiplier: number;
  powerMultiplier: number;
  rollingResistance: number;
  label: 'TRACK' | 'RUNOFF' | 'GRASS';
}

/**
 * Arcade-first surface response based on distance from the racing-line centre.
 * The road is intentionally forgiving near the edge, then progressively slower
 * so cutting across the infield is never a competitive shortcut.
 */
export function surfaceEffect(distanceFromLine: number): SurfaceEffect {
  const edge = 70;
  const severity = clamp01((Math.max(0, distanceFromLine) - edge) / 70);
  const label: SurfaceEffect['label'] = severity <= 0 ? 'TRACK' : severity < 0.38 ? 'RUNOFF' : 'GRASS';

  return {
    severity,
    gripMultiplier: 1 - severity * 0.42,
    powerMultiplier: 1 - severity * 0.55,
    rollingResistance: severity * 10,
    label,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
