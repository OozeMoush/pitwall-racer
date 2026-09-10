export interface SurfaceEffect {
  severity: number;
  gripMultiplier: number;
  powerMultiplier: number;
  rollingResistance: number;
  label: 'TRACK' | 'RUNOFF' | 'GRASS';
}

// The road edge is at roughly 28 m from the centreline and the visible car is
// about 4.3 m wide in simulation space. A centreline distance below ~29.6 still
// represents the normal "one side on the kerb" attack. Beyond that, most/all of
// the car is outside the white line, so the penalty ramps sharply before the
// grass. This turns deep apex cuts into an obvious time loss without making the
// kerb itself untouchable.
const FREE_KERB_DISTANCE = 29.6;
const DEEP_KERB_DISTANCE = 31.2;
const DEEP_KERB_SEVERITY = 0.42;
const FULL_GRASS_DISTANCE = 53.2;

/**
 * High-speed excursions must lose enough speed that a shortcut is never the
 * optimal line. Low-speed recovery remains possible because the controller's
 * rough-surface drag is strongly speed-dependent rather than a huge constant
 * force.
 */
export function surfaceEffect(distanceFromLine: number): SurfaceEffect {
  const distance = Math.max(0, distanceFromLine);
  let severity = 0;

  if (distance > FREE_KERB_DISTANCE && distance <= DEEP_KERB_DISTANCE) {
    severity = DEEP_KERB_SEVERITY
      * clamp01((distance - FREE_KERB_DISTANCE) / (DEEP_KERB_DISTANCE - FREE_KERB_DISTANCE));
  } else if (distance > DEEP_KERB_DISTANCE) {
    severity = DEEP_KERB_SEVERITY
      + (1 - DEEP_KERB_SEVERITY)
        * clamp01((distance - DEEP_KERB_DISTANCE) / (FULL_GRASS_DISTANCE - DEEP_KERB_DISTANCE));
  }

  const label: SurfaceEffect['label'] = severity <= 0
    ? 'TRACK'
    : distance < 42
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
