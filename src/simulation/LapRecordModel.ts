import type { Compound } from './TireModel';
import { timingTone, type TimingTone } from './TimingToneModel';

export function lapTyreLabel(start: Compound, end: Compound, pitted: boolean): string {
  if (!pitted && start === end) return start[0];
  return `${start[0]}→${end[0]}·P`;
}

/**
 * A sector completed on the current lap is not in lap history yet. Treat it as
 * the provisional personal best when it beats the historical PB, but always
 * compare it against the latest session record so an older purple sector can
 * turn green/neutral as soon as somebody else beats it.
 */
export function liveTimingTone(
  value: number,
  historicalPersonalBest: number | undefined,
  sessionBest: number | undefined,
): TimingTone {
  const personalBest = historicalPersonalBest === undefined
    ? value
    : Math.min(value, historicalPersonalBest);
  return timingTone(value, personalBest, sessionBest);
}
