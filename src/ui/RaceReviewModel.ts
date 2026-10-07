import { raceDistance } from '../simulation/RaceModel';
import type { RaceSummary, SummaryEvent, SummaryLap } from '../simulation/RaceSummaryModel';
import type { Compound } from '../simulation/TireModel';

export const TYRE_NAMES: Record<Compound, string> = { SOFT: 'ソフト', MEDIUM: 'ミディアム', HARD: 'ハード' };
export const TYRE_COLORS: Record<Compound, string> = { SOFT: '#ff7184', MEDIUM: '#f1d461', HARD: '#e5edf5' };
export const GRAPH = { width: 800, height: 310, left: 70, right: 746, top: 40, bottom: 258 };
export function reviewCars(summary: RaceSummary) { return summary.cutoff?.cars ?? summary.samples.at(-1)?.cars ?? []; }
export function defaultReviewRival(summary: RaceSummary): string {
  const cars = reviewCars(summary);
  const player = cars.find(car => car.id === 'player');
  const rivals = cars.filter(car => car.id !== 'player').sort((a, b) => a.position - b.position);
  return (rivals.find(car => car.position === (player?.position ?? 1) - 1)
    ?? rivals.find(car => car.position === (player?.position ?? 1) + 1)
    ?? rivals[0])?.id ?? '';
}
export function resolveReviewRival(summary: RaceSummary, requested: string): string {
  return reviewCars(summary).some(car => car.id === requested && car.id !== 'player') ? requested : defaultReviewRival(summary);
}
/** Compound best is a counted, completed, positive non-pit lap on one compound.
 * GP counted laps do not imply clean driving; no clean-lap filtering here. */
export function tyreBests(summary: RaceSummary): Record<Compound, SummaryLap | undefined> {
  const best: Record<Compound, SummaryLap | undefined> = { SOFT: undefined, MEDIUM: undefined, HARD: undefined };
  for (const lap of summary.laps) {
    if (lap.driverId !== 'player' || !lap.counted || lap.pitted || lap.startCompound !== lap.endCompound
      || !Number.isFinite(lap.seconds) || lap.seconds <= 0) continue;
    if (!best[lap.startCompound] || lap.seconds < best[lap.startCompound]!.seconds) best[lap.startCompound] = lap;
  }
  return best;
}
export interface BattlePoint { lap: number; time: number; gap: number | null; observed: boolean }
export interface BattleMarker { lap: number; event: SummaryEvent; player: boolean }
export interface BattleGraph { points: BattlePoint[]; markers: BattleMarker[]; range: number; totalLaps: number }
export function battleGraph(summary: RaceSummary, requested: string): BattleGraph {
  const selected = resolveReviewRival(summary, requested);
  const totalLaps = Math.max(1, summary.context.totalLaps);
  const points = summary.samples.flatMap(sample => {
    const player = sample.cars.find(car => car.id === 'player');
    if (!player) return [{time: sample.time, lap: 0, gap: null, observed: false}];
    const rival = sample.cars.find(car => car.id === selected);
    return [{ observed: true, time: sample.time, lap: Math.max(0, Math.min(totalLaps, raceDistance(player.lap, player.progress) - 1)),
      gap: rival?.lapDifference === 0 && rival.gapToPlayerSeconds !== null && Number.isFinite(rival.gapToPlayerSeconds)
        ? rival.gapToPlayerSeconds : null }];
  });
  // Event time is exact. Its horizontal lap coordinate interpolates observed
  // player progress only; never interpolate measured gaps or bridge recovery.
  const progressAt = (time: number): number | undefined => {
    const next = points.findIndex(point => point.time >= time);
    if (next < 0) return undefined;
    if (points[next].time === time) return points[next].observed ? points[next].lap : undefined;
    if (next === 0) return undefined;
    const a = points[next - 1], b = points[next];
    if (!a.observed || !b.observed || b.lap < a.lap || b.time <= a.time) return undefined;
    return a.lap + (b.lap - a.lap) * (time - a.time) / (b.time - a.time);
  };
  const markers = summary.events.flatMap(event => {
    if ((event.driverId !== 'player' && event.driverId !== selected) || (event.kind !== 'PIT_IN' && event.kind !== 'REJOIN')) return [];
    const lap = progressAt(event.time);
    return lap === undefined ? [] : [{ lap, event, player: event.driverId === 'player' }];
  });
  const extreme = points.reduce((max, point) => Math.max(max, Math.abs(point.gap ?? 0)), 1);
  const step = extreme <= 5 ? 1 : extreme <= 20 ? 5 : extreme <= 60 ? 10 : 30;
  return { points, markers, totalLaps, range: Math.ceil(extreme / step) * step };
}
export function graphX(lap: number, totalLaps: number): number { return GRAPH.left + lap / totalLaps * (GRAPH.right - GRAPH.left); }
export function graphY(gap: number, range: number): number { return GRAPH.top + (gap + range) / (range * 2) * (GRAPH.bottom - GRAPH.top); }
export function gapLabel(gap: number | null): string {
  return gap === null ? '計測不足・周回差のため比較なし' : gap === 0 ? '同タイム' : `あなたが${gap < 0 ? '後ろ' : '前'} · ${Math.abs(gap).toFixed(2)}秒差`;
}
