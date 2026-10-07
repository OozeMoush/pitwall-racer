import { cleanHistoryLap, historyConditionKey, type DriverHistory, type DriverLap } from '../simulation/DriverHistoryStore';
export function historyGroups(history: DriverHistory, trackId: string): DriverLap[] {
  const groups = new Map<string, DriverLap>();
  for (const lap of [...history.bests, ...history.updates.map(u => u.lap), ...history.laps]) {
    if (lap.trackId !== trackId) continue;
    const key = historyConditionKey(lap);
    const old = groups.get(key);
    if (!old || lap.recordedAt > old.recordedAt) groups.set(key, lap);
  }
  return [...groups.values()].sort((a,b) => b.recordedAt - a.recordedAt);
}
export function historyGroupSummary(history: DriverHistory, key: string) {
  const laps = history.laps.filter(l => historyConditionKey(l) === key).slice(-20);
  const clean = laps.filter(cleanHistoryLap);
  const mean = clean.length ? clean.reduce((sum, l) => sum + l.seconds, 0) / clean.length : null;
  const deviation = clean.length >= 3 && mean !== null
    ? Math.sqrt(clean.reduce((sum,l) => sum + (l.seconds - mean) ** 2, 0) / clean.length) : null;
  return { laps, cleanCount: clean.length, mean, deviation,
    best: history.bests.find(l => historyConditionKey(l) === key),
    updates: history.updates.filter(u => historyConditionKey(u.lap) === key) };
}
