export interface PitwallAbsoluteProfileSample {
  speed: number;
  throttle: number;
  brake: number;
}

/**
 * Exact 64-node progress trace from the 25.692 s legal machine-only Rapier lap.
 *
 * This is deliberately not player telemetry and the 24.342 player PB is not an
 * input. The trace is a migration seed that lets longitudinal control stop
 * consulting ReferenceDriverModel while preserving a trajectory the shared
 * physical chassis has already demonstrated legally.
 */
export const PITWALL_ABSOLUTE_PROFILE: readonly PitwallAbsoluteProfileSample[] = [
  { speed: 63.9241, throttle: 1.0000, brake: 0.0000 },
  { speed: 68.3332, throttle: 1.0000, brake: 0.0000 },
  { speed: 72.1389, throttle: 1.0000, brake: 0.0000 },
  { speed: 75.5582, throttle: 1.0000, brake: 0.0000 },
  { speed: 78.5380, throttle: 1.0000, brake: 0.0000 },
  { speed: 81.2416, throttle: 1.0000, brake: 0.0000 },
  { speed: 83.6394, throttle: 1.0000, brake: 0.0000 },
  { speed: 85.8089, throttle: 1.0000, brake: 0.0000 },
  { speed: 87.7316, throttle: 1.0000, brake: 0.0000 },
  { speed: 89.5116, throttle: 1.0000, brake: 0.0000 },
  { speed: 91.1220, throttle: 1.0000, brake: 0.0000 },
  { speed: 92.5776, throttle: 1.0000, brake: 0.0000 },
  { speed: 93.9240, throttle: 1.0000, brake: 0.0000 },
  { speed: 95.1435, throttle: 1.0000, brake: 0.0000 },
  { speed: 96.2692, throttle: 1.0000, brake: 0.0000 },
  { speed: 97.2712, throttle: 1.0000, brake: 0.0000 },
  { speed: 98.1627, throttle: 1.0000, brake: 0.0000 },
  { speed: 98.9829, throttle: 1.0000, brake: 0.0000 },
  { speed: 99.6516, throttle: 1.0000, brake: 0.0000 },
  { speed: 99.9672, throttle: 1.0000, brake: 0.0000 },
  { speed: 99.5356, throttle: 1.0000, brake: 0.0000 },
  { speed: 97.7412, throttle: 1.0000, brake: 0.0000 },
  { speed: 95.0139, throttle: 1.0000, brake: 0.0000 },
  { speed: 91.2204, throttle: 1.0000, brake: 0.0000 },
  { speed: 88.2082, throttle: 1.0000, brake: 0.0000 },
  { speed: 87.0486, throttle: 1.0000, brake: 0.0000 },
  { speed: 88.3526, throttle: 1.0000, brake: 0.0000 },
  { speed: 90.0266, throttle: 1.0000, brake: 0.0000 },
  { speed: 91.5153, throttle: 1.0000, brake: 0.0000 },
  { speed: 92.9082, throttle: 1.0000, brake: 0.0000 },
  { speed: 94.1758, throttle: 1.0000, brake: 0.0000 },
  { speed: 95.2715, throttle: 1.0000, brake: 0.0000 },
  { speed: 95.9563, throttle: 0.0000, brake: 0.0610 },
  { speed: 88.0662, throttle: 0.0000, brake: 0.6836 },
  { speed: 74.4919, throttle: 0.0000, brake: 1.0000 },
  { speed: 55.7041, throttle: 0.0000, brake: 1.0000 },
  { speed: 46.8276, throttle: 0.0000, brake: 0.0620 },
  { speed: 49.0931, throttle: 1.0000, brake: 0.0000 },
  { speed: 54.0016, throttle: 1.0000, brake: 0.0000 },
  { speed: 59.2534, throttle: 1.0000, brake: 0.0000 },
  { speed: 63.8874, throttle: 1.0000, brake: 0.0000 },
  { speed: 67.9776, throttle: 1.0000, brake: 0.0000 },
  { speed: 71.8578, throttle: 1.0000, brake: 0.0000 },
  { speed: 75.2835, throttle: 1.0000, brake: 0.0000 },
  { speed: 77.8719, throttle: 1.0000, brake: 0.0000 },
  { speed: 79.3250, throttle: 1.0000, brake: 0.0000 },
  { speed: 80.8249, throttle: 1.0000, brake: 0.0000 },
  { speed: 82.7769, throttle: 1.0000, brake: 0.0000 },
  { speed: 84.3842, throttle: 1.0000, brake: 0.0000 },
  { speed: 84.8539, throttle: 1.0000, brake: 0.0000 },
  { speed: 84.5960, throttle: 1.0000, brake: 0.0000 },
  { speed: 85.2905, throttle: 1.0000, brake: 0.0000 },
  { speed: 86.2562, throttle: 1.0000, brake: 0.0000 },
  { speed: 87.3845, throttle: 1.0000, brake: 0.0000 },
  { speed: 87.8762, throttle: 1.0000, brake: 0.0000 },
  { speed: 80.9482, throttle: 0.0000, brake: 0.5783 },
  { speed: 69.1056, throttle: 0.4321, brake: 0.0000 },
  { speed: 59.1218, throttle: 0.0000, brake: 0.8200 },
  { speed: 51.0462, throttle: 0.0000, brake: 0.4547 },
  { speed: 53.5505, throttle: 0.5757, brake: 0.0369 },
  { speed: 45.0897, throttle: 0.0000, brake: 0.5065 },
  { speed: 48.0749, throttle: 1.0000, brake: 0.0000 },
  { speed: 54.3237, throttle: 1.0000, brake: 0.0000 },
  { speed: 59.0651, throttle: 1.0000, brake: 0.0000 },
] as const;

export function samplePitwallAbsoluteProfile(progress: number): PitwallAbsoluteProfileSample {
  const p = wrap01(progress);
  const scaled = p * PITWALL_ABSOLUTE_PROFILE.length;
  const index = Math.floor(scaled) % PITWALL_ABSOLUTE_PROFILE.length;
  const next = (index + 1) % PITWALL_ABSOLUTE_PROFILE.length;
  const t = scaled - Math.floor(scaled);
  const a = PITWALL_ABSOLUTE_PROFILE[index];
  const b = PITWALL_ABSOLUTE_PROFILE[next];
  return {
    speed: lerp(a.speed, b.speed, t),
    throttle: lerp(a.throttle, b.throttle, t),
    brake: lerp(a.brake, b.brake, t),
  };
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
