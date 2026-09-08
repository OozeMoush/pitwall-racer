export type TimingTone = 'neutral' | 'personal-best' | 'session-best';

const EPSILON = 0.0005;

/**
 * F1-style timing semantics used by the HUD:
 * purple = best seen anywhere in the race, green = driver's personal best.
 */
export function timingTone(
  value: number | undefined,
  personalBest: number | undefined,
  sessionBest: number | undefined,
): TimingTone {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 'neutral';
  if (sessionBest !== undefined && Number.isFinite(sessionBest) && Math.abs(value - sessionBest) <= EPSILON) {
    return 'session-best';
  }
  if (personalBest !== undefined && Number.isFinite(personalBest) && Math.abs(value - personalBest) <= EPSILON) {
    return 'personal-best';
  }
  return 'neutral';
}

export function minimumPositive(values: readonly (number | undefined)[]): number | undefined {
  const valid = values.filter((value): value is number => value !== undefined && Number.isFinite(value) && value > 0);
  return valid.length > 0 ? Math.min(...valid) : undefined;
}
