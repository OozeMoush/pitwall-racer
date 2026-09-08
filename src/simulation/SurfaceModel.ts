export interface SurfaceEffect {
  severity: number;
  gripMultiplier: number;
  powerMultiplier: number;
  rollingResistance: number;
  label: 'TRACK' | 'RUNOFF' | 'GRASS';
}

/**
 * Arcade-first surface response based on distance from the racing-line centre.
 * The visible road is now intentionally tighter, so leaving ~50 units from the
 * centre starts costing pace rather than providing a giant forgiving runway.
 */
export function surfaceEffect(distanceFromLine: number): SurfaceEffect {
  const edge = 50;
  const severity = clamp01((Math.max(0, distanceFromLine) - edge) / 52);
  const label: SurfaceEffect['label'] = severity <= 0 ? 'TRACK' : severity < 0.38 ? 'RUNOFF' : 'GRASS';

  return {
    severity,
    gripMultiplier: 1 - severity * 0.46,
    powerMultiplier: 1 - severity * 0.58,
    rollingResistance: severity * 11,
    label,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
