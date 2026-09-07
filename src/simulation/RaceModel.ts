import { createTire, stepTire, type Compound, type PaceMode, type TireState } from './TireModel';
import { TRACK_LENGTH } from './TrackModel';

export type BattleState = 'CLEAR' | 'FOLLOW' | 'ATTACK';

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
  preferredLane: number;
  battleState: BattleState;
  skill: number;
  finished: boolean;
}

export interface AeroEffect {
  tow: number;
  dirtyAir: number;
  carAhead?: DriverState;
}

interface TrafficContext {
  carAhead?: DriverState;
  gapMetres: number;
}

export function createAiField(): DriverState[] {
  const plans: Array<[string, Compound, number, Compound, number, number]> = [
    ['NOVA', 'SOFT', 4, 'MEDIUM', -5, 1.012],
    ['APEX', 'MEDIUM', 6, 'SOFT', 4, 1.018],
    ['VOLT', 'HARD', 7, 'SOFT', -2, 0.997],
    ['ORBIT', 'MEDIUM', 5, 'HARD', 3, 1.004],
    ['KITE', 'SOFT', 3, 'HARD', -4, 0.992],
    ['RIFT', 'HARD', 6, 'MEDIUM', 2, 1.008],
    ['ZEN', 'MEDIUM', 5, 'SOFT', 0, 1.0],
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
    preferredLane: laneOffset,
    battleState: 'CLEAR',
    skill,
    finished: false,
  }));
}

export function stepAiField(drivers: DriverState[], dt: number, totalLaps: number): DriverState[] {
  return drivers.map((driver) => stepAi(driver, dt, totalLaps, trafficFor(driver, drivers)));
}

export function stepAi(
  driver: DriverState,
  dt: number,
  totalLaps: number,
  traffic: TrafficContext = { gapMetres: Number.POSITIVE_INFINITY },
): DriverState {
  if (driver.finished) return driver;

  const remaining = totalLaps - driver.lap;
  const tireHealth = 1 - driver.tire.wear;
  const pace: PaceMode = remaining <= 2 && tireHealth > 0.35 ? 'PUSH' : tireHealth < 0.28 ? 'CONSERVE' : 'BALANCED';

  const following = traffic.gapMetres < 48;
  const canAttack = traffic.carAhead !== undefined
    && traffic.gapMetres < 17
    && tireHealth > 0.2
    && driver.skill * driver.tire.grip > traffic.carAhead.skill * traffic.carAhead.tire.grip * 0.995;
  const battleState: BattleState = canAttack ? 'ATTACK' : following ? 'FOLLOW' : 'CLEAR';

  const trafficLoad = battleState === 'FOLLOW' ? 0.1 : battleState === 'ATTACK' ? 0.14 : 0;
  let tire = stepTire(driver.tire, pace, (pace === 'PUSH' ? 0.78 : 0.55) + trafficLoad, dt);
  let lap = driver.lap;
  let progress = driver.progress;
  let usedCompounds = driver.usedCompounds;

  const compoundPace = tire.compound === 'SOFT' ? 1.025 : tire.compound === 'HARD' ? 0.985 : 1;
  const pacePace = pace === 'PUSH' ? 1.018 : pace === 'CONSERVE' ? 0.982 : 1;
  const towBoost = battleState === 'FOLLOW' ? 1.012 : battleState === 'ATTACK' ? 1.026 : 1;
  let speed = 72 * driver.skill * compoundPace * pacePace * tire.grip * towBoost;

  if (traffic.carAhead && traffic.gapMetres < 9 && battleState !== 'ATTACK') {
    speed = Math.min(speed, traffic.carAhead.speed * 0.992);
  }

  const attackSide = stableSide(driver.id) * 24;
  const targetLane = battleState === 'ATTACK'
    ? traffic.carAhead!.laneOffset + attackSide
    : battleState === 'FOLLOW' && traffic.carAhead
      ? traffic.carAhead.laneOffset
      : driver.preferredLane;
  const laneOffset = approach(driver.laneOffset, targetLane, dt * (battleState === 'ATTACK' ? 52 : 34));

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
  return { ...driver, progress, lap, speed, tire, pace, usedCompounds, laneOffset, battleState, finished };
}

function trafficFor(driver: DriverState, field: DriverState[]): TrafficContext {
  const distance = raceDistance(driver.lap, driver.progress);
  let carAhead: DriverState | undefined;
  let closest = Number.POSITIVE_INFINITY;

  for (const other of field) {
    if (other.id === driver.id || other.finished) continue;
    const delta = raceDistance(other.lap, other.progress) - distance;
    if (delta > 0 && delta < closest) {
      closest = delta;
      carAhead = other;
    }
  }

  return { carAhead, gapMetres: closest * TRACK_LENGTH };
}

function stableSide(id: string): -1 | 1 {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return (hash & 1) === 0 ? -1 : 1;
}

function approach(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
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
