import { createTire, stepTire, type Compound, type PaceMode, type TireState } from './TireModel';
import { trackProfile } from './TrackProfile';
import { TRACK_LENGTH } from './TrackModel';

export type BattleState = 'CLEAR' | 'FOLLOW' | 'ATTACK';
export type StrategyIntent = 'PLAN' | 'UNDERCUT' | 'OVERCUT' | 'DONE';

export interface DriverState {
  id: string;
  name: string;
  progress: number;
  lap: number;
  speed: number;
  tire: TireState;
  pace: PaceMode;
  usedCompounds: Set<Compound>;
  plannedPitLap: number;
  pitLap: number;
  strategyIntent: StrategyIntent;
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
    ['NOVA', 'SOFT', 4, 'MEDIUM', -3, 1.018],
    ['APEX', 'MEDIUM', 6, 'SOFT', 3, 1.028],
    ['VOLT', 'HARD', 7, 'SOFT', -2, 1.002],
    ['ORBIT', 'MEDIUM', 5, 'HARD', 2, 1.012],
    ['KITE', 'SOFT', 3, 'HARD', -3, 0.994],
    ['RIFT', 'HARD', 6, 'MEDIUM', 2, 1.008],
    ['ZEN', 'MEDIUM', 5, 'SOFT', 0, 1.004],
  ];

  return plans.map(([name, start, plannedPitLap, next, laneOffset, skill], index) => ({
    id: `ai-${index}`,
    name,
    progress: 0.065 - index * 0.008,
    lap: 1,
    speed: 0,
    tire: createTire(start),
    pace: 'BALANCED',
    usedCompounds: new Set<Compound>([start]),
    plannedPitLap,
    pitLap: plannedPitLap,
    strategyIntent: 'PLAN',
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

  const strategy = choosePitStrategy(driver, battleState, traffic.gapMetres, tireHealth, totalLaps);
  const pitLap = strategy.pitLap;
  let strategyIntent = strategy.intent;

  const trafficLoad = battleState === 'FOLLOW' ? 0.1 : battleState === 'ATTACK' ? 0.14 : 0;
  let tire = stepTire(driver.tire, pace, (pace === 'PUSH' ? 0.78 : 0.55) + trafficLoad, dt);
  let lap = driver.lap;
  let progress = driver.progress;
  let usedCompounds = driver.usedCompounds;

  const profile = trackProfile(progress, driver.skill, tire.grip);
  const paceFactor = pace === 'PUSH' ? 1.025 : pace === 'CONSERVE' ? 0.975 : 1;
  const towFactor = battleState === 'FOLLOW' ? 1.012 : battleState === 'ATTACK' ? 1.025 : 1;
  let targetSpeed = Math.min(111, profile.targetSpeed * paceFactor * towFactor);

  // Following is a real longitudinal constraint rather than a magic progress
  // adjustment: the chaser closes, then has to match the car ahead unless it
  // has committed to an overtaking line.
  if (traffic.carAhead && traffic.gapMetres < 10 && battleState !== 'ATTACK') {
    targetSpeed = Math.min(targetSpeed, traffic.carAhead.speed * 0.995);
  }

  // Brake more strongly than we accelerate. This creates visible braking zones
  // and means a late look-ahead target actually produces a corner entry rather
  // than cars gliding around at one constant pace.
  const speed = approachSpeed(driver.speed, targetSpeed, dt, 33, 82);

  const attackSide = stableSide(driver.id) * 25;
  const normalLine = profile.apexOffset + driver.preferredLane * 0.35;
  const targetLane = battleState === 'ATTACK'
    ? profile.apexOffset + attackSide
    : battleState === 'FOLLOW' && traffic.carAhead
      ? traffic.carAhead.laneOffset
      : normalLine;
  const laneOffset = approach(driver.laneOffset, targetLane, dt * (battleState === 'ATTACK' ? 54 : 38));

  progress += (speed * dt) / TRACK_LENGTH;

  if (progress >= 1) {
    progress -= 1;
    lap += 1;
    if (lap === pitLap + 1 && !usedCompounds.has(driver.nextCompound)) {
      tire = createTire(driver.nextCompound);
      usedCompounds = new Set(usedCompounds);
      usedCompounds.add(driver.nextCompound);
      progress = Math.max(0, progress - 0.055); // AI pit time remains abstract until AI pit animation is rebuilt.
      strategyIntent = 'DONE';
    }
  }

  const finished = lap > totalLaps;
  return { ...driver, progress, lap, speed, tire, pace, usedCompounds, pitLap, strategyIntent, laneOffset, battleState, finished };
}

function choosePitStrategy(
  driver: DriverState,
  battleState: BattleState,
  gapMetres: number,
  tireHealth: number,
  totalLaps: number,
): { pitLap: number; intent: StrategyIntent } {
  if (driver.usedCompounds.has(driver.nextCompound)) {
    return { pitLap: driver.pitLap, intent: 'DONE' };
  }

  const earliest = Math.max(2, driver.plannedPitLap - 1);
  const latest = Math.min(totalLaps - 1, driver.plannedPitLap + 1);

  if (driver.lap >= earliest && driver.lap < driver.plannedPitLap && battleState === 'FOLLOW' && gapMetres < 30 && tireHealth > 0.24) {
    return { pitLap: earliest, intent: 'UNDERCUT' };
  }

  if (driver.lap >= driver.plannedPitLap && driver.lap < latest && battleState === 'CLEAR' && tireHealth > 0.52) {
    return { pitLap: latest, intent: 'OVERCUT' };
  }

  if (driver.strategyIntent === 'UNDERCUT' || driver.strategyIntent === 'OVERCUT') {
    return { pitLap: driver.pitLap, intent: driver.strategyIntent };
  }

  return { pitLap: driver.plannedPitLap, intent: 'PLAN' };
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

function approachSpeed(current: number, target: number, dt: number, acceleration: number, braking: number): number {
  const rate = target >= current ? acceleration : braking;
  return approach(current, target, rate * dt);
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
