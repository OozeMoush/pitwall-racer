export interface SurfaceEffect {
  severity: number;
  gripMultiplier: number;
  powerMultiplier: number;
  rollingResistance: number;
  speedDrag: number;
  label: 'TRACK' | 'RUNOFF' | 'GRASS';
}

/**
 * The physical road is intentionally narrow. A wheel-width mistake is allowed,
 * but using runoff or grass as extra race track must cost meaningful time.
 *
 * Keep low-speed recovery possible by avoiding huge constant resistance. The
 * extra penalty is speed-proportional instead: almost harmless while crawling
 * back to the road, but strong enough at racing speed that cutting across the
 * runoff/grass is never the fast line.
 */
export function surfaceEffect(distanceFromLine: number): SurfaceEffect {
  const edge = 29;
  const severity = clamp01((Math.max(0, distanceFromLine) - edge) / 28);
  const label: SurfaceEffect['label'] = severity <= 0 ? 'TRACK' : severity < 0.45 ? 'RUNOFF' : 'GRASS';

  return {
    severity,
    gripMultiplier: 1 - severity * 0.48,
    powerMultiplier: 1 - severity * 0.24,
    rollingResistance: severity * 4.4,
    // m/s^2 contribution is speedDrag * current speed in ArcadeCarController.
    // Full grass at 100 m/s therefore adds ~12 m/s^2 of deceleration, while at
    // 10 m/s it adds only ~1.2 m/s^2 so the car can still drive back out.
    speedDrag: severity * (0.07 + severity * 0.05),
    label,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
