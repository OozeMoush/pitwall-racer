import { createTire, stepTire, type Compound, type PaceMode, type TireState } from './TireModel';
import { trackProfile } from './TrackProfile';
import { TRACK_LENGTH } from './TrackModel';

export type BattleState = 'CLEAR' | 'FOLLOW' | 'ATTACK' | 'DEFEND' | 'SIDE_BY_SIDE';
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

export interface RaceTrafficCar {
  id: string;
  lap: number;
  progress: number;
  speed: number;
  laneOffset: number;
  performance: number;
  isPlayer?: boolean;
}

export interface AeroEffect {
  tow: number;
  dirtyAir: number;
  carAhead?: DriverState;
}

interface TrafficContext {
  carAhead?: RaceTrafficCar;
  gapMetres: number;
  carBehind?: RaceTrafficCar;
  gapBehindMetres: number;
  alongside?: RaceTrafficCar;
}

const EMPTY_TRAFFIC: TrafficContext = {
  gapMetres: Number.POSITIVE_INFINITY,
  gapBehindMetres: Number.POSITIVE_INFINITY,
};

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

  return plans.map(([name, start, plannedPitLap, next, preferredLane, skill], index) => ({
    id: `ai-${index}`,
    name,
    // A real staggered grid. The old 0.8%-lap spacing was shorter than the
    // rendered car body, which made the field visibly overlap before turn one.
    progress: 0.135 - index * 0.018,
    lap: 1,
    speed: 0,
    tire: createTire(start),
    pace: 'BALANCED',
    usedCompounds: new Set<Compound>([start]),
    plannedPitLap,
    pitLap: plannedPitLap,
    strategyIntent: 'PLAN',
    nextCompound: next,
    laneOffset: index % 2 === 0 ? -16 : 16,
    preferredLane,
    battleState: 'CLEAR',
    skill,
    finished: false,
  }));
}

export function stepAiField(
  drivers: DriverState[],
  dt: number,
  totalLaps: number,
  externalTraffic: RaceTrafficCar[] = [],
): DriverState[] {
  return drivers.map((driver) => stepAi(driver, dt, totalLaps, trafficFor(driver, drivers, externalTraffic)));
}

export function stepAi(
  driver: DriverState,
  dt: number,
  totalLaps: number,
  traffic: TrafficContext = EMPTY_TRAFFIC,
): DriverState {
  if (driver.finished) return driver;

  const remaining = totalLaps - driver.lap;
  const tireHealth = 1 - driver.tire.wear;
  const pace: PaceMode = remaining <= 2 && tireHealth > 0.35 ? 'PUSH' : tireHealth < 0.28 ? 'CONSERVE' : 'BALANCED';
  const ownPerformance = driver.skill * driver.tire.grip;

  const following = traffic.gapMetres < 48;
  const canAttack = traffic.carAhead !== undefined
    && traffic.gapMetres < 17
    && tireHealth > 0.2
    && ownPerformance > traffic.carAhead.performance * 0.995;
  const playerThreatBehind = traffic.carBehind?.isPlayer === true
    && traffic.gapBehindMetres < 30
    && traffic.gapBehindMetres > 7;
  const playerAlongside = traffic.alongside?.isPlayer === true;

  const battleState: BattleState = playerAlongside
    ? 'SIDE_BY_SIDE'
    : canAttack
      ? 'ATTACK'
      : following
        ? 'FOLLOW'
        : playerThreatBehind
          ? 'DEFEND'
          : 'CLEAR';

  const strategy = choosePitStrategy(driver, battleState, traffic.gapMetres, tireHealth, totalLaps);
  const pitLap = strategy.pitLap;
  let strategyIntent = strategy.intent;

  const trafficLoad = battleState === 'FOLLOW'
    ? 0.1
    : battleState === 'ATTACK' || battleState === 'SIDE_BY_SIDE'
      ? 0.14
      : battleState === 'DEFEND'
        ? 0.07
        : 0;
  let tire = stepTire(driver.tire, pace, (pace === 'PUSH' ? 0.78 : 0.55) + trafficLoad, dt);
  let lap = driver.lap;
  let progress = driver.progress;
  let usedCompounds = driver.usedCompounds;

  const profile = trackProfile(progress, driver.skill, tire.grip);
  const paceFactor = pace === 'PUSH' ? 1.025 : pace === 'CONSERVE' ? 0.975 : 1;
  const towFactor = battleState === 'FOLLOW' ? 1.012 : battleState === 'ATTACK' ? 1.025 : 1;
  let targetSpeed = Math.min(111, profile.targetSpeed * paceFactor * towFactor);

  if (traffic.carAhead && traffic.gapMetres < 10 && battleState !== 'ATTACK' && battleState !== 'SIDE_BY_SIDE') {
    targetSpeed = Math.min(targetSpeed, traffic.carAhead.speed * 0.995);
  }

  if (traffic.alongside && battleState === 'SIDE_BY_SIDE') {
    targetSpeed = Math.min(targetSpeed, Math.max(44, traffic.alongside.speed + 4));
  }

  const speed = approachSpeed(driver.speed, targetSpeed, dt, 33, 82);

  const attackSide = stableSide(driver.id) * 25;
  const normalLine = profile.apexOffset + driver.preferredLane * 0.35;
  let targetLane = normalLine;

  if (battleState === 'ATTACK') {
    targetLane = profile.apexOffset + attackSide;
  } else if (battleState === 'FOLLOW' && traffic.carAhead) {
    targetLane = traffic.carAhead.laneOffset;
  } else if (battleState === 'DEFEND') {
    const inside = Math.abs(profile.signedTurn) > 0.04
      ? Math.sign(profile.signedTurn) * (9 + profile.severity * 8)
      : stableSide(driver.id) * 8;
    targetLane = clamp(inside, -19, 19);
  } else if (battleState === 'SIDE_BY_SIDE' && traffic.alongside) {
    const separationSide = driver.laneOffset >= traffic.alongside.laneOffset ? 1 : -1;
    const desiredSeparation = traffic.alongside.laneOffset + separationSide * 28;
    targetLane = clamp(desiredSeparation, -35, 35);
  }

  const laneRate = battleState === 'ATTACK'
    ? 54
    : battleState === 'SIDE_BY_SIDE'
      ? 62
      : battleState === 'DEFEND'
        ? 34
        : 38;
  const laneOffset = approach(driver.laneOffset, targetLane, dt * laneRate);

  progress += (speed * dt) / TRACK_LENGTH;

  if (progress >= 1) {
    progress -= 1;
    lap += 1;
    if (lap === pitLap + 1 && !usedCompounds.has(driver.nextCompound)) {
      tire = createTire(driver.nextCompound);
      usedCompounds = new Set(usedCompounds);
      usedCompounds.add(driver.nextCompound);
      progress = Math.max(0, progress - 0.055);
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
  if (driver.usedCompounds.has(driver.nextCompound)) return { pitLap: driver.pitLap, intent: 'DONE' };

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

function trafficFor(driver: DriverState, field: DriverState[], externalTraffic: RaceTrafficCar[]): TrafficContext {
  const distance = raceDistance(driver.lap, driver.progress);
  const candidates: RaceTrafficCar[] = [
    ...field
      .filter((other) => other.id !== driver.id && !other.finished)
      .map(toTrafficCar),
    ...externalTraffic.filter((other) => other.id !== driver.id),
  ];

  let carAhead: RaceTrafficCar | undefined;
  let gapMetres = Number.POSITIVE_INFINITY;
  let carBehind: RaceTrafficCar | undefined;
  let gapBehindMetres = Number.POSITIVE_INFINITY;
  let alongside: RaceTrafficCar | undefined;
  let alongsideDistance = Number.POSITIVE_INFINITY;

  for (const other of candidates) {
    const deltaMetres = (raceDistance(other.lap, other.progress) - distance) * TRACK_LENGTH;
    if (deltaMetres > 0 && deltaMetres < gapMetres) {
      gapMetres = deltaMetres;
      carAhead = other;
    }
    if (deltaMetres < 0 && -deltaMetres < gapBehindMetres) {
      gapBehindMetres = -deltaMetres;
      carBehind = other;
    }
    const absolute = Math.abs(deltaMetres);
    const lateralGap = Math.abs(other.laneOffset - driver.laneOffset);
    // SIDE_BY_SIDE means the car bodies overlap longitudinally and occupy
    // distinct lanes. A car directly 10-15m ahead is still ATTACK/FOLLOW.
    if (absolute <= 8 && lateralGap >= 8 && lateralGap <= 42 && absolute < alongsideDistance) {
      alongsideDistance = absolute;
      alongside = other;
    }
  }

  return { carAhead, gapMetres, carBehind, gapBehindMetres, alongside };
}

function toTrafficCar(driver: DriverState): RaceTrafficCar {
  return {
    id: driver.id,
    lap: driver.lap,
    progress: driver.progress,
    speed: driver.speed,
    laneOffset: driver.laneOffset,
    performance: driver.skill * driver.tire.grip,
  };
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
