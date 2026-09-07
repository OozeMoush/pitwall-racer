import { createTire, stepTire, type Compound, type PaceMode, type TireState } from './TireModel';
import { TRACK_LENGTH } from './TrackModel';

export interface DriverState {
  id: string;
  name: string;
  progress: number;
  lap: number;
  speed: number;
  tire: TireState;
  pace: PaceMode;
  usedCompounds: Set<Compound>;
  pitLap: number;
  nextCompound: Compound;
  laneOffset: number;
  skill: number;
  finished: boolean;
}

export interface AeroEffect {
  tow: number;
  dirtyAir: number;
  carAhead?: DriverState;
}

export function createAiField(): DriverState[] {
  const plans: Array<[string, Compound, number, Compound, number, number]> = [
    ['NOVA', 'SOFT', 4, 'MEDIUM', -16, 1.012],
    ['APEX', 'MEDIUM', 6, 'SOFT', -8, 1.018],
    ['VOLT', 'HARD', 7, 'SOFT', 0, 0.997],
    ['ORBIT', 'MEDIUM', 5, 'HARD', 8, 1.004],
    ['KITE', 'SOFT', 3, 'HARD', 16, 0.992],
    ['RIFT', 'HARD', 6, 'MEDIUM', -12, 1.008],
    ['ZEN', 'MEDIUM', 5, 'SOFT', 12, 1.0],
  ];

  return plans.map(([name, start, pitLap, next, laneOffset, skill], index) => ({
    id: `ai-${index}`,
    name,
    progress: 0.065 - index * 0.008,
    lap: 1,
    speed: 0,
    tire: createTire(start),
    pace: 'BALANCED',
    usedCompounds: new Set<Compound>([start]),
    pitLap,
    nextCompound: next,
    laneOffset,
    skill,
    finished: false,
  }));
}

export function stepAi(driver: DriverState, dt: number, totalLaps: number): DriverState {
  if (driver.finished) return driver;

  const remaining = totalLaps - driver.lap;
  const tireHealth = 1 - driver.tire.wear;
  const pace: PaceMode = remaining <= 2 && tireHealth > 0.35 ? 'PUSH' : tireHealth < 0.28 ? 'CONSERVE' : 'BALANCED';
  let tire = stepTire(driver.tire, pace, pace === 'PUSH' ? 0.78 : 0.55, dt);
  let lap = driver.lap;
  let progress = driver.progress;
  let usedCompounds = driver.usedCompounds;

  const compoundPace = tire.compound === 'SOFT' ? 1.025 : tire.compound === 'HARD' ? 0.985 : 1;
  const pacePace = pace === 'PUSH' ? 1.018 : pace === 'CONSERVE' ? 0.982 : 1;
  const speed = 72 * driver.skill * compoundPace * pacePace * tire.grip;
  progress += (speed * dt) / TRACK_LENGTH;

  if (progress >= 1) {
    progress -= 1;
    lap += 1;
    if (lap === driver.pitLap + 1 && !usedCompounds.has(driver.nextCompound)) {
      tire = createTire(driver.nextCompound);
      usedCompounds = new Set(usedCompounds);
      usedCompounds.add(driver.nextCompound);
      progress = Math.max(0, progress - 0.055); // approximate pit-lane time loss
    }
  }

  const finished = lap > totalLaps;
  return { ...driver, progress, lap, speed, tire, pace, usedCompounds, finished };
}

export function raceDistance(lap: number, progress: number): number {
  return Math.max(0, lap - 1) + progress;
}

export function classify<T extends { lap: number; progress: number; id: string }>(drivers: T[]): T[] {
  return [...drivers].sort((a, b) => raceDistance(b.lap, b.progress) - raceDistance(a.lap, a.progress));
}

export function aeroEffect(playerLap: number, playerProgress: number, ai: DriverState[]): AeroEffect {
  const playerDistance = raceDistance(playerLap, playerProgress);
  let nearest: DriverState | undefined;
  let delta = Number.POSITIVE_INFINITY;

  for (const car of ai) {
    const d = raceDistance(car.lap, car.progress) - playerDistance;
    if (d > 0 && d < delta) {
      delta = d;
      nearest = car;
    }
  }

  if (!nearest) return { tow: 0, dirtyAir: 0 };
  const metres = delta * TRACK_LENGTH;
  if (metres > 55) return { tow: 0, dirtyAir: 0 };

  const proximity = 1 - metres / 55;
  return {
    tow: 0.07 * proximity,
    dirtyAir: 0.18 * proximity,
    carAhead: nearest,
  };
}

export function isTwoCompoundLegal(used: Set<Compound>): boolean {
  return used.size >= 2;
}
