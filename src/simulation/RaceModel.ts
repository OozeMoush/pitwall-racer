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
  lateralGapAhead: number;
  carBehind?: RaceTrafficCar;
  gapBehindMetres: number;
  alongside?: RaceTrafficCar;
}

const EMPTY_TRAFFIC: TrafficContext = {
  gapMetres: Number.POSITIVE_INFINITY,
  lateralGapAhead: Number.POSITIVE_INFINITY,
  gapBehindMetres: Number.POSITIVE_INFINITY,
};

export function createAiField(): DriverState[] {
  const plans: Array<[string, Compound, number, Compound, number, number]> = [
    ['NOVA', 'SOFT', 4, 'MEDIUM', -5, 1.062],
    ['APEX', 'MEDIUM', 6, 'SOFT', 5, 1.082],
    ['VOLT', 'HARD', 7, 'SOFT', -4, 1.032],
    ['ORBIT', 'MEDIUM', 5, 'HARD', 4, 1.054],
    ['KITE', 'SOFT', 3, 'HARD', -5, 1.024],
    ['RIFT', 'HARD', 6, 'MEDIUM', 4, 1.043],
    ['ZEN', 'MEDIUM', 5, 'SOFT', 0, 1.038],
  ];

  return plans.map(([name, start, plannedPitLap, next, preferredLane, skill], index) => ({
    id: `ai-${index}`,
    name,
    progress: 0.052 - Math.floor(index / 2) * 0.0135,
    lap: 1,
    speed: 0,
    tire: createTire(start),
    pace: 'BALANCED',
    usedCompounds: new Set<Compound>([start]),
    plannedPitLap,
    pitLap: plannedPitLap,
    strategyIntent: 'PLAN',
    nextCompound: next,
    laneOffset: index % 2 === 0 ? -22 : 22,
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

  const laneBlocked = traffic.lateralGapAhead < 22;
  const following = traffic.gapMetres < 74 && laneBlocked;
  const closingFast = traffic.carAhead !== undefined && driver.speed > traffic.carAhead.speed + 1.5;
  const canAttack = traffic.carAhead !== undefined
    && traffic.gapMetres < 42
    && tireHealth > 0.16
    && (ownPerformance > traffic.carAhead.performance * 0.94 || closingFast);
  const playerThreatBehind = traffic.carBehind?.isPlayer === true
    && traffic.gapBehindMetres < 36
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
  const paceFactor = pace === 'PUSH' ? 1.035 : pace === 'CONSERVE' ? 0.968 : 1;
  const towFactor = battleState === 'FOLLOW' ? 1.022 : battleState === 'ATTACK' ? 1.058 : 1;
  const attackKick = battleState === 'ATTACK' && profile.severity < 0.28 ? 6.5 : 0;
  let targetSpeed = Math.min(116, profile.targetSpeed * paceFactor * towFactor + attackKick);

  // Only queue behind a car that is genuinely occupying the same lane. Once an
  // attacker has moved out, it is allowed to use its own pace and complete the
  // pass instead of being permanently speed-capped into a train.
  if (traffic.carAhead && traffic.gapMetres < 72 && laneBlocked && battleState !== 'ATTACK' && battleState !== 'SIDE_BY_SIDE') {
    targetSpeed = Math.min(targetSpeed, traffic.carAhead.speed * 0.994);
  }

  if (traffic.alongside && battleState === 'SIDE_BY_SIDE') {
    if (profile.severity < 0.35) {
      targetSpeed = Math.max(targetSpeed, Math.min(116, traffic.alongside.speed + 6));
    } else {
      targetSpeed = Math.min(targetSpeed, Math.max(44, traffic.alongside.speed + 2));
    }
  }

  const speed = approachSpeed(driver.speed, targetSpeed, dt, 44, 108);

  const attackSide = stableSide(driver.id) * 46;
  const normalLine = profile.apexOffset + driver.preferredLane * 0.35;
  let targetLane = normalLine;

  if (battleState === 'ATTACK') {
    // If the leader already occupies our stable side, choose the other side so
    // two attackers do not all pile onto one identical passing line.
    const leaderLane = traffic.carAhead?.laneOffset ?? 0;
    const preferredAttack = Math.abs(leaderLane - attackSide) > 21 ? attackSide : -attackSide;
    targetLane = clamp(profile.apexOffset + preferredAttack, -50, 50);
  } else if (battleState === 'FOLLOW' && traffic.carAhead) {
    targetLane = traffic.carAhead.laneOffset;
  } else if (battleState === 'DEFEND') {
    const inside = Math.abs(profile.signedTurn) > 0.04
      ? Math.sign(profile.signedTurn) * (12 + profile.severity * 10)
      : stableSide(driver.id) * 10;
    targetLane = clamp(inside, -24, 24);
  } else if (battleState === 'SIDE_BY_SIDE' && traffic.alongside) {
    const separationSide = driver.laneOffset >= traffic.alongside.laneOffset ? 1 : -1;
    targetLane = clamp(traffic.alongside.laneOffset + separationSide * 32, -50, 50);
  }

  const laneRate = battleState === 'ATTACK'
    ? 92
    : battleState === 'SIDE_BY_SIDE'
      ? 86
      : battleState === 'DEFEND'
        ? 40
        : 48;
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

  if (driver.lap >= earliest && driver.lap < driver.plannedPitLap && battleState === 'FOLLOW' && gapMetres < 36 && tireHealth > 0.24) {
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
  let lateralGapAhead = Number.POSITIVE_INFINITY;
  let carBehind: RaceTrafficCar | undefined;
  let gapBehindMetres = Number.POSITIVE_INFINITY;
  let alongside: RaceTrafficCar | undefined;
  let alongsideDistance = Number.POSITIVE_INFINITY;

  for (const other of candidates) {
    const deltaMetres = (raceDistance(other.lap, other.progress) - distance) * TRACK_LENGTH;
    if (deltaMetres > 0 && deltaMetres < gapMetres) {
      gapMetres = deltaMetres;
      carAhead = other;
      lateralGapAhead = Math.abs(other.laneOffset - driver.laneOffset);
    }
    if (deltaMetres < 0 && -deltaMetres < gapBehindMetres) {
      gapBehindMetres = -deltaMetres;
      carBehind = other;
    }
    const absolute = Math.abs(deltaMetres);
    const lateralGap = Math.abs(other.laneOffset - driver.laneOffset);
    if (absolute <= 10 && lateralGap >= 9 && lateralGap <= 54 && absolute < alongsideDistance) {
      alongsideDistance = absolute;
      alongside = other;
    }
  }

  return { carAhead, gapMetres, lateralGapAhead, carBehind, gapBehindMetres, alongside };
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
  if (metres > 70) return { tow: 0, dirtyAir: 0 };

  const proximity = 1 - metres / 70;
  return {
    tow: 0.09 * proximity,
    dirtyAir: 0.17 * proximity,
    carAhead: nearest,
  };
}

export function isTwoCompoundLegal(used: Set<Compound>): boolean {
  return used.size >= 2;
}
