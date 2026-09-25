import { aerodynamicEffect } from './AeroModel';
import { aiGridSlot, gridPositionFor, gridSlotForPosition } from './GridModel';
import { AI_SAFE_LANE_LIMIT } from './TrackLimitsModel';
import { createTire, stepTire, type Compound, type PaceMode, type TireState } from './TireModel';
import { trackProfile } from './TrackProfile';
import { raceScaleDistance, TRACK_LENGTH } from './TrackModel';

export type BattleState = 'CLEAR' | 'FOLLOW' | 'ATTACK' | 'DEFEND' | 'SIDE_BY_SIDE';
export type StrategyIntent = 'PLAN' | 'UNDERCUT' | 'OVERCUT' | 'DONE';

export interface AiPitPlanStop {
  plannedLap: number;
  compound: Compound;
}

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
  pitPlan: readonly AiPitPlanStop[];
  pitStopIndex: number;
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

export function createAiField(
  gridOrder?: readonly string[],
  totalLaps = 50,
): DriverState[] {
  // Most cars run one stop, but one deliberately aggressive strategy adds a
  // second stop. KITE attacks on Soft, uses Medium for the middle stint, then
  // returns to Soft for the finish. Stop fractions scale across 40/50/60 laps.
  const plans: Array<[
    string,
    Compound,
    ReadonlyArray<readonly [number, Compound]>,
    number,
    number,
  ]> = [
    ['NOVA', 'SOFT', [[0.22, 'HARD']], -4, 1.130],
    ['APEX', 'MEDIUM', [[0.40, 'HARD']], 4, 1.136],
    ['VOLT', 'HARD', [[0.62, 'MEDIUM']], -3, 1.120],
    ['ORBIT', 'MEDIUM', [[0.72, 'SOFT']], 3, 1.131],
    ['KITE', 'SOFT', [[0.24, 'MEDIUM'], [0.72, 'SOFT']], -4, 1.127],
    ['RIFT', 'HARD', [[0.76, 'SOFT']], 3, 1.118],
    ['ZEN', 'MEDIUM', [[0.74, 'SOFT']], 0, 1.129],
  ];

  const safeRaceLaps = Math.max(6, Math.round(totalLaps));
  return plans.map(([name, start, stopDefinitions, preferredLane, skill], index) => {
    const id = `ai-${index}`;
    const qualifiedPosition = gridPositionFor(id, gridOrder);
    const grid = qualifiedPosition === undefined ? aiGridSlot(index) : gridSlotForPosition(qualifiedPosition);
    const pitPlan: AiPitPlanStop[] = stopDefinitions.map(([fraction, compound]) => ({
      plannedLap: Math.max(
        4,
        Math.min(safeRaceLaps - 3, Math.round(safeRaceLaps * fraction)),
      ),
      compound,
    }));
    const firstStop = pitPlan[0];
    return {
      id,
      name,
      progress: grid.progress,
      lap: 0,
      speed: 0,
      tire: createTire(start),
      pace: 'BALANCED',
      usedCompounds: new Set<Compound>([start]),
      plannedPitLap: firstStop.plannedLap,
      pitLap: firstStop.plannedLap,
      strategyIntent: 'PLAN',
      nextCompound: firstStop.compound,
      pitPlan,
      pitStopIndex: 0,
      laneOffset: grid.laneOffset,
      preferredLane,
      battleState: 'CLEAR',
      skill,
      finished: false,
    };
  });
}

export function stepAiField(
  drivers: DriverState[],
  dt: number,
  totalLaps: number,
  externalTraffic: RaceTrafficCar[] = [],
  advanceProgress = true,
): DriverState[] {
  return drivers.map((driver) => stepAi(
    driver,
    dt,
    totalLaps,
    trafficFor(driver, drivers, externalTraffic),
    advanceProgress,
  ));
}

export function stepAi(
  driver: DriverState,
  dt: number,
  totalLaps: number,
  traffic: TrafficContext = EMPTY_TRAFFIC,
  advanceProgress = true,
): DriverState {
  if (driver.finished) return driver;

  const remaining = totalLaps - Math.max(1, driver.lap);
  const tireHealth = 1 - driver.tire.wear;
  const pace: PaceMode = remaining <= 4 && tireHealth > 0.35 ? 'PUSH' : tireHealth < 0.28 ? 'CONSERVE' : 'BALANCED';
  const ownPerformance = driver.skill * driver.tire.grip;

  const laneBlocked = traffic.lateralGapAhead < 6.5;
  const following = traffic.gapMetres < raceScaleDistance(76) && laneBlocked;
  const closingFast = traffic.carAhead !== undefined && driver.speed > traffic.carAhead.speed + 1.5;
  const canAttack = traffic.carAhead !== undefined
    && traffic.gapMetres < raceScaleDistance(56)
    && tireHealth > 0.16
    && (ownPerformance > traffic.carAhead.performance * 0.94 || closingFast);
  const playerThreatBehind = traffic.carBehind?.isPlayer === true
    && traffic.gapBehindMetres < raceScaleDistance(48)
    && traffic.gapBehindMetres > raceScaleDistance(8);
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
  let pitStopIndex = driver.pitStopIndex;
  let plannedPitLap = driver.plannedPitLap;
  let activePitLap = pitLap;
  let nextCompound = driver.nextCompound;

  const profile = trackProfile(progress, driver.skill, tire.grip);
  const paceFactor = pace === 'PUSH' ? 1.035 : pace === 'CONSERVE' ? 0.968 : 1;
  const towFactor = battleState === 'FOLLOW' ? 1.022 : battleState === 'ATTACK' ? 1.058 : 1;
  const attackKick = battleState === 'ATTACK' && profile.severity < 0.28 ? 6.5 : 0;
  let targetSpeed = Math.min(122, profile.targetSpeed * paceFactor * towFactor + attackKick);

  if (traffic.carAhead && traffic.gapMetres < raceScaleDistance(76) && laneBlocked && battleState !== 'ATTACK' && battleState !== 'SIDE_BY_SIDE') {
    targetSpeed = Math.min(targetSpeed, traffic.carAhead.speed * 0.996);
  }

  if (traffic.alongside && battleState === 'SIDE_BY_SIDE') {
    if (profile.severity < 0.35) {
      targetSpeed = Math.max(targetSpeed, Math.min(122, traffic.alongside.speed + 6));
    } else {
      targetSpeed = Math.min(targetSpeed, Math.max(44, traffic.alongside.speed + 2));
    }
  }

  const speed = approachSpeed(driver.speed, targetSpeed, dt, 50, 116);

  const attackSide = stableSide(driver.id) * 6.2;
  const normalLine = clamp(profile.apexOffset + driver.preferredLane * 0.16, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
  let targetLane = normalLine;

  if (battleState === 'ATTACK') {
    const leaderLane = traffic.carAhead?.laneOffset ?? 0;
    const preferredAttack = Math.abs(leaderLane - attackSide) > 4.8 ? attackSide : -attackSide;
    targetLane = clamp(preferredAttack, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
  } else if (battleState === 'FOLLOW' && traffic.carAhead) {
    targetLane = clamp(traffic.carAhead.laneOffset, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
  } else if (battleState === 'DEFEND') {
    const inside = Math.abs(profile.signedTurn) > 0.04
      ? Math.sign(profile.signedTurn) * 4.8
      : stableSide(driver.id) * 3.4;
    targetLane = clamp(inside, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
  } else if (battleState === 'SIDE_BY_SIDE' && traffic.alongside) {
    const separationSide = driver.laneOffset >= traffic.alongside.laneOffset ? 1 : -1;
    targetLane = clamp(traffic.alongside.laneOffset + separationSide * 5.7, -AI_SAFE_LANE_LIMIT, AI_SAFE_LANE_LIMIT);
  }

  const laneRate = battleState === 'ATTACK'
    ? 68
    : battleState === 'SIDE_BY_SIDE'
      ? 62
      : battleState === 'DEFEND'
        ? 38
        : 44;
  const laneOffset = approach(driver.laneOffset, targetLane, dt * laneRate);

  if (advanceProgress) {
    progress += (speed * dt) / TRACK_LENGTH;

    if (progress >= 1) {
      progress -= 1;
      lap += 1;
      if (lap === activePitLap + 1 && pitStopIndex < driver.pitPlan.length) {
        tire = createTire(nextCompound);
        usedCompounds = new Set(usedCompounds);
        usedCompounds.add(nextCompound);
        progress = Math.max(0, progress - 0.055);
        pitStopIndex += 1;
        const followingStop = driver.pitPlan[pitStopIndex];
        if (followingStop) {
          plannedPitLap = followingStop.plannedLap;
          activePitLap = followingStop.plannedLap;
          nextCompound = followingStop.compound;
          strategyIntent = 'PLAN';
        } else {
          strategyIntent = 'DONE';
        }
      }
    }
  }

  const finished = lap > totalLaps;
  return {
    ...driver,
    progress,
    lap,
    speed,
    tire,
    pace,
    usedCompounds,
    plannedPitLap,
    pitLap: activePitLap,
    strategyIntent,
    nextCompound,
    pitStopIndex,
    laneOffset,
    battleState,
    finished,
  };
}

function choosePitStrategy(
  driver: DriverState,
  battleState: BattleState,
  gapMetres: number,
  tireHealth: number,
  totalLaps: number,
): { pitLap: number; intent: StrategyIntent } {
  if (driver.pitStopIndex >= driver.pitPlan.length) {
    return { pitLap: driver.pitLap, intent: 'DONE' };
  }

  // Let long races breathe: a strategy can move two laps either way rather than
  // the old one-lap window that was designed around twelve-lap sprints.
  const earliest = Math.max(4, driver.plannedPitLap - 2);
  const latest = Math.min(totalLaps - 3, driver.plannedPitLap + 2);

  if (driver.lap >= earliest && driver.lap < driver.plannedPitLap && battleState === 'FOLLOW' && gapMetres < raceScaleDistance(42) && tireHealth > 0.24) {
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
    if (absolute <= raceScaleDistance(18) && lateralGap >= 4.2 && lateralGap <= 13 && absolute < alongsideDistance) {
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
  return Math.max(0, lap) + progress;
}

export function classify<T extends { lap: number; progress: number; id: string }>(drivers: T[]): T[] {
  return [...drivers].sort((a, b) => raceDistance(b.lap, b.progress) - raceDistance(a.lap, a.progress));
}

export function aeroEffect(
  playerLap: number,
  playerProgress: number,
  ai: DriverState[],
  playerLaneOffset = 0,
): AeroEffect {
  const shared = aerodynamicEffect(
    { id: 'player', lap: playerLap, progress: playerProgress, laneOffset: playerLaneOffset },
    ai.map((car) => ({ id: car.id, lap: car.lap, progress: car.progress, laneOffset: car.laneOffset })),
  );
  const carAhead = shared.sourceId === undefined ? undefined : ai.find((car) => car.id === shared.sourceId);
  return { tow: shared.tow, dirtyAir: shared.dirtyAir, carAhead };
}

export function isTwoCompoundLegal(used: Set<Compound>): boolean {
  return used.size >= 2;
}
