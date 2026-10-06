import type { Compound } from './TireModel';
import { raceDistance } from './RaceModel';

export type ObservedPitPhase = 'NONE' | 'TRANSIT_IN' | 'SERVICE' | 'TRANSIT_OUT';
export interface PaceLap {
  lap: number;
  lapTime: number;
  pitted: boolean;
  valid?: boolean;
  paceValid?: boolean;
}
export interface RivalCar {
  id: string;
  name: string;
  lap: number;
  progress: number;
  compound: Compound;
  phase: ObservedPitPhase;
}

/** Compare the latest jointly completed lap, including start/pit/out/invalid laps.
 * Nonfinite or unfinished timing still cannot produce a meaningful difference. */
export function compareRivalPace(player: readonly PaceLap[], rival: readonly PaceLap[], completedLap: number): { delta?: number; laps: number[] } {
  for (let lap = completedLap; lap >= 1; lap--) {
    const a = player.find(row => row.lap === lap);
    const b = rival.find(row => row.lap === lap);
    if (!a || !b) continue;
    if (!Number.isFinite(a.lapTime) || !Number.isFinite(b.lapTime) || a.lapTime <= 0 || b.lapTime <= 0) continue;
    return { delta: b.lapTime - a.lapTime, laps: [lap] };
  }
  return { delta: undefined, laps: [] };
}

/** Classification neighbours, not nearest cars on the physical road. A lap
 * counter difference near the timing line alone does not imply lapping. */
export function rivalNeighbours(standings: readonly RivalCar[]): Array<{ side: 'AHEAD' | 'BEHIND'; car?: RivalCar; lapped: boolean }> {
  const index = standings.findIndex(car => car.id === 'player');
  const player = standings[index];
  return (['AHEAD', 'BEHIND'] as const).map((side, i) => {
    const car = index < 0 ? undefined : standings[index + (i === 0 ? -1 : 1)];
    return { side, car, lapped: !!car && !!player && Math.abs(raceDistance(car.lap, car.progress) - raceDistance(player.lap, player.progress)) >= 1 };
  });
}

export interface PitNotice { id: string; text: string; until: number; }
export class RivalPitObserver {
  private previous = new Map<string, ObservedPitPhase>();
  private notices: PitNotice[] = [];
  private neighbourIds: readonly string[] = [];
  reset(): void { this.previous.clear(); this.notices = []; this.neighbourIds = []; }
  update(cars: readonly RivalCar[], neighbourIds: readonly string[], time: number): void {
    this.notices = this.notices.filter(notice => notice.until > time);
    for (const car of cars) {
      if (car.id === 'player') continue;
      const previous = this.previous.get(car.id) ?? 'NONE';
      this.previous.set(car.id, car.phase);
      if (previous === car.phase) continue;
      // Existing notices survive a ranking change caused by the stop itself.
      if (!neighbourIds.includes(car.id) && !this.neighbourIds.includes(car.id) && !this.notices.some(notice => notice.id === car.id)) continue;
      const event = car.phase === 'TRANSIT_IN' ? 'PIT IN'
        : car.phase === 'SERVICE' ? 'PIT BOX'
        : car.phase === 'TRANSIT_OUT' ? `TYRES ${car.compound} · PIT OUT`
        : previous === 'TRANSIT_OUT' ? `REJOINED · ${car.compound}` : undefined;
      if (!event) continue;
      this.notices = this.notices.filter(notice => notice.id !== car.id);
      this.notices.push({ id: car.id, text: `${car.name} · ${event}`, until: time + 4 });
      this.notices = this.notices.slice(-2);
    }
    this.neighbourIds = [...neighbourIds];
  }
  visible(time: number): readonly PitNotice[] { return this.notices.filter(notice => notice.until > time); }
}
