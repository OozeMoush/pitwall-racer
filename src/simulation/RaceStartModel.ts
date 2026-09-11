export type LaunchQuality = 'PERFECT' | 'GOOD' | 'BOGGED' | 'WHEELSPIN';

export interface LaunchResult {
  quality: LaunchQuality;
  label: string;
  powerBoost: number;
}

export function stepLaunchCharge(charge: number, throttleHeld: boolean, dt: number): number {
  const rate = throttleHeld ? 0.72 : -0.26;
  return clamp(charge + rate * dt, 0, 1);
}

/**
 * Keyboard input is binary, so the skill is timing rather than analogue pedal
 * modulation. Press W roughly one second before lights-out to land in the
 * launch window. Holding from the first light overcharges the launch and spins.
 */
export function evaluateLaunch(charge: number): LaunchResult {
  if (charge >= 0.58 && charge <= 0.80) {
    return { quality: 'PERFECT', label: 'PERFECT LAUNCH', powerBoost: 0.14 };
  }
  if (charge >= 0.40 && charge <= 0.90) {
    return { quality: 'GOOD', label: 'GOOD LAUNCH', powerBoost: 0.065 };
  }
  if (charge > 0.90) {
    return { quality: 'WHEELSPIN', label: 'WHEELSPIN', powerBoost: -0.085 };
  }
  return { quality: 'BOGGED', label: 'BOGGED START', powerBoost: -0.045 };
}

export function launchTone(quality: LaunchQuality): 'good' | 'bad' | 'neutral' {
  if (quality === 'PERFECT' || quality === 'GOOD') return 'good';
  if (quality === 'WHEELSPIN' || quality === 'BOGGED') return 'bad';
  return 'neutral';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
