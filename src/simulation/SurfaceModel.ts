export interface SurfaceEffect {
  severity: number;
  gripMultiplier: number;
  powerMultiplier: number;
  rollingResistance: number;
  label: 'TRACK' | 'RUNOFF' | 'GRASS';
}

/**
 * The physical road is intentionally narrow. Running wide must cost enough
 * speed that cutting through runoff or grass is never the fast line.
 *
 * Low-speed recovery remains possible: most of the new penalty comes from the
 * controller's speed-dependent rough-surface drag, not an enormous constant
 * rolling resistance that would trap a stopped car.
 */
export function surfaceEffect(distanceFromLine: number): SurfaceEffect {
  const edge = 29;
  const severity = clamp01((Math.max(0, distanceFromLine) - edge) / 24);
  const label: SurfaceEffect['label'] = severity <= 0 ? 'TRACK' : severity < 0.48 ? 'RUNOFF' : 'GRASS';

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
