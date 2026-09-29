import { aerodynamicEffect } from './AeroModel';
import { aiGridSlot, gridPositionFor, gridSlotForPosition } from './GridModel';
import { AI_SAFE_LANE_LIMIT } from './TrackLimitsModel';
import { createTire, stepTire, type Compound, type PaceMode, type TireState } from './TireModel';
import { trackProfile } from './TrackProfile';
import { raceScaleDistance, TRACK_LENGTH } from './TrackModel';

export type BattleState = 'CLEAR' | 'FOLLOW';
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
}

const EMPTY_TRAFFIC: TrafficContext = {
  gapMetres: Number.POSITIVE_INFINITY,
  lateralGapAhead: Number.POSITIVE_INFINITY,
};

export function createAiField(
  gridOrder?: readonly string[],
  totalLaps = 50,
): DriverState[] {
  // Strategy families are anchored to the duration-scale benchmark rather
  // than the retired fixed-lap race. Most cars run competitive M/H one-stops;
  // NOVA keeps the viable short Soft opening stint, while KITE and RIFT expose
  // two distinct two-stop families for live race variety.
  const plans: Array<[
    string,
    Compound,
    ReadonlyArray<readonly [number, Compound]>,
    number,
    number,
  ]> = [
    ['NOVA', 'SOFT', [[0.22, 'HARD']], -4, 1.130],
    ['APEX', 'MEDIUM', [[0.33, 'HARD']], 4, 1.136],
    ['VOLT', 'HARD', [[0.67, 'MEDIUM']], -3, 1.120],
    ['ORBIT', 'MEDIUM', [[0.39, 'HARD']], 3, 1.131],
    ['KITE', 'HARD', [[0.39, 'MEDIUM'], [0.67, 'HARD']], -4, 1.127],
    ['RIFT', 'HARD', [[0.39, 'SOFT'], [0.61, 'HARD']], 3, 1.118],
    ['ZEN', 'HARD', [[0.61, 'MEDIUM']], 0, 1.129],
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

  const laneBlocked = traffic.lateralGapAhead < 6.5;
  const following = traffic.gapMetres < raceScaleDistance(76) && laneBlocked;

  // CPU traffic is longitudinal only. CPU cars never invent a second racing
  // line to pass or defend because CPU↔CPU contact is disabled. Keeping them on
  // the shared reference line prevents clustered fields from steering one
  // another into walls.
  const battleState: BattleState = following ? 'FOLLOW' : 'CLEAR';

  const strategy = choosePitStrategy(driver, battleState, traffic.gapMetres, tireHealth, totalLaps);
  const pitLap = strategy.pitLap;
  let strategyIntent = strategy.intent;

  const trafficLoad = battleState === 'FOLLOW' ? 0.1 : 0;
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
  const towFactor = battleState === 'FOLLOW' ? 1.022 : 1;
  let targetSpeed = Math.min(122, profile.targetSpeed * paceFactor * towFactor);

  if (traffic.carAhead && traffic.gapMetres < raceScaleDistance(76) && laneBlocked) {
    targetSpeed = Math.min(targetSpeed, traffic.carAhead.speed * 0.996);
  }

  const speed = approachSpeed(driver.speed, targetSpeed, dt, 50, 116);

  const targetLane = clamp(
    profile.apexOffset + driver.preferredLane * 0.16,
    -AI_SAFE_LANE_LIMIT,
    AI_SAFE_LANE_LIMIT,
  );
  const laneOffset = approach(driver.laneOffset, targetLane, dt * 44);

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

  // Once an undercut/overcut has been committed, do not reverse that call on a
  // later controller tick just because traffic cleared or the planned lap was
  // reached. The physical pit-entry model reads driver.pitLap continuously, so
  // changing it at the last moment can make a car drive past its intended stop.
  if (driver.strategyIntent === 'UNDERCUT' || driver.strategyIntent === 'OVERCUT') {
    return { pitLap: driver.pitLap, intent: driver.strategyIntent };
  }

  // One-stop plans can react by two laps in either direction. Multi-stop
  // plans stay on their benchmarked schedule: moving one stop by two laps can
  // collapse the next stint into an immediate second pit visit on an 18-lap
  // race, which is not useful racecraft.
  const reactionWindow = driver.pitPlan.length > 1 ? 0 : 2;
  const earliest = Math.max(4, driver.plannedPitLap - reactionWindow);
  const latest = Math.min(totalLaps - 3, driver.plannedPitLap + reactionWindow);

  if (driver.lap >= earliest && driver.lap < driver.plannedPitLap && battleState === 'FOLLOW' && gapMetres < raceScaleDistance(42) && tireHealth > 0.24) {
    return { pitLap: earliest, intent: 'UNDERCUT' };
  }

  if (driver.lap >= driver.plannedPitLap && driver.lap < latest && battleState === 'CLEAR' && tireHealth > 0.52) {
    return { pitLap: latest, intent: 'OVERCUT' };
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

  for (const other of candidates) {
    const deltaMetres = (raceDistance(other.lap, other.progress) - distance) * TRACK_LENGTH;
    if (deltaMetres > 0 && deltaMetres < gapMetres) {
      gapMetres = deltaMetres;
      carAhead = other;
      lateralGapAhead = Math.abs(other.laneOffset - driver.laneOffset);
    }
  }

  return { carAhead, gapMetres, lateralGapAhead };
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
