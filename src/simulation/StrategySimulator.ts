import { pitStopTimeLossEstimateSecondsFor } from './PitLaneModel';
import { circuitScalePresetFor, getTrackDefinition, type TrackId } from './TrackModel';
import {
  createTire,
  gripRatioToMedium,
  stepTire,
  type Compound,
  type PaceMode,
  type TireState,
} from './TireModel';
import {
  REPRESENTATIVE_SLIDE_PENALTY_SECONDS,
  tyreSlideRisk,
} from './TyrePerformanceModel';

export interface StrategyStop {
  afterLap: number;
  compound: Compound;
}

export interface StrategyPlan {
  name: string;
  startCompound: Compound;
  stops?: readonly StrategyStop[];
  paceForLap: (lap: number, tire: TireState) => PaceMode;
}

export interface StrategyRaceProfile {
  trackId: TrackId;
  totalLaps: number;
  representativeLapSeconds: number;
  pitLossSeconds: number;
  /** Per-lap strategic effect normalized so lap count alone does not amplify tyre value. */
  strategyEffectScale: number;
}

export interface SimulatedLap {
  lap: number;
  compound: Compound;
  pace: PaceMode;
  lapTime: number;
  wearAtEnd: number;
  gripAverage: number;
}

export interface StrategyResult {
  name: string;
  totalTime: number;
  legal: boolean;
  usedCompounds: Set<Compound>;
  laps: SimulatedLap[];
}

export interface BalanceSnapshot {
  fastest: StrategyResult;
  fastestOneStop: StrategyResult;
  fastestTwoStop: StrategyResult;
  oneStopResults: StrategyResult[];
  twoStopResults: StrategyResult[];
  legalResults: StrategyResult[];
  competitiveResults: StrategyResult[];
  spreadToSecond: number;
}

// Preserve the existing per-format tyre response while separating stop cost
// from driving performance. These are approximate harness coefficients, not
// measured physical grip. A pit-time experiment must never rescale tyre pace.
const MAX_REPRESENTATIVE_CORNER_SECONDS = 10.8;
const STRATEGY_REFERENCE_LAP_SECONDS = 90;
const COMPACT_STRATEGY_RESPONSE = 0.35;
const DT = 0.5;
const GRIP_RESPONSE_EXPONENT = 0.85;
const COMPOUNDS: readonly Compound[] = ['SOFT', 'MEDIUM', 'HARD'];

const modeLoad: Record<PaceMode, number> = {
  CONSERVE: 0.48,
  BALANCED: 0.64,
  PUSH: 0.88,
};

const modeLapAdjustment: Record<PaceMode, number> = {
  CONSERVE: 0.48,
  BALANCED: 0,
  PUSH: -1.15,
};

export function strategyRaceProfile(
  trackId: TrackId,
  totalLaps: number,
  pitLossSeconds = pitStopTimeLossEstimateSecondsFor(trackId),
): StrategyRaceProfile {
  const representativeLapSeconds = Math.max(
    15,
    getTrackDefinition(trackId).referenceLapSeconds ?? STRATEGY_REFERENCE_LAP_SECONDS,
  );
  // Lap-count normalization is independent from the pit-cost input. The
  // inherited Compact response is held fixed until physical race calibration.
  const formatResponse = circuitScalePresetFor(trackId) === 'COMPACT'
    ? COMPACT_STRATEGY_RESPONSE : 1;
  const strategyEffectScale = clamp(
    representativeLapSeconds / STRATEGY_REFERENCE_LAP_SECONDS * formatResponse,
    0.04,
    1.5,
  );

  return {
    trackId,
    totalLaps: Math.max(1, Math.round(totalLaps)),
    representativeLapSeconds,
    pitLossSeconds,
    strategyEffectScale,
  };
}

export function simulateStrategy(
  plan: StrategyPlan,
  race: StrategyRaceProfile,
): StrategyResult {
  let tire = createTire(plan.startCompound);
  const usedCompounds = new Set<Compound>([plan.startCompound]);
  const laps: SimulatedLap[] = [];
  let totalTime = 0;

  const stops = [...(plan.stops ?? [])]
    .filter((stop) => stop.afterLap >= 1 && stop.afterLap < race.totalLaps)
    .sort((a, b) => a.afterLap - b.afterLap);
  const stopsByLap = new Map<number, StrategyStop>();
  for (const stop of stops) stopsByLap.set(stop.afterLap, stop);

  for (let lap = 1; lap <= race.totalLaps; lap++) {
    const pace = plan.paceForLap(lap, tire);
    let gripSum = 0;
    let slideRiskSum = 0;
    let samples = 0;

    for (
      let elapsed = 0;
      elapsed < race.representativeLapSeconds;
      elapsed += DT
    ) {
      const dt = Math.min(DT, race.representativeLapSeconds - elapsed);
      tire = stepTire(tire, pace, modeLoad[pace], dt);
      gripSum += tire.grip;
      slideRiskSum += tyreSlideRisk(tire.wear);
      samples += 1;
    }

    const gripAverage = gripSum / Math.max(1, samples);
    const slideRiskAverage = slideRiskSum / Math.max(1, samples);
    const cornerSeconds = Math.min(
      MAX_REPRESENTATIVE_CORNER_SECONDS,
      race.representativeLapSeconds * 0.45,
    ) * race.strategyEffectScale;
    const straightSeconds = race.representativeLapSeconds - cornerSeconds;
    const relativeGrip = Math.max(0.56, gripRatioToMedium(gripAverage));
    const lapTime = straightSeconds
      + cornerSeconds / Math.pow(relativeGrip, GRIP_RESPONSE_EXPONENT)
      + slideRiskAverage * REPRESENTATIVE_SLIDE_PENALTY_SECONDS * race.strategyEffectScale
      + modeLapAdjustment[pace] * race.strategyEffectScale;
    totalTime += lapTime;
    laps.push({
      lap,
      compound: tire.compound,
      pace,
      lapTime,
      wearAtEnd: tire.wear,
      gripAverage,
    });

    const stop = stopsByLap.get(lap);
    if (stop) {
      totalTime += race.pitLossSeconds;
      tire = createTire(stop.compound);
      usedCompounds.add(stop.compound);
    }
  }

  return {
    name: plan.name,
    totalTime,
    legal: usedCompounds.size >= 2,
    usedCompounds,
    laps,
  };
}

export function balancedPace(_: number, tire: TireState): PaceMode {
  if (tire.wear > 0.72) return 'CONSERVE';
  return 'BALANCED';
}

export function pushAlways(): PaceMode {
  return 'PUSH';
}

interface BalancedStintTable {
  laps: SimulatedLap[];
  cumulativeTime: number[];
}

function balancedStintTable(
  compound: Compound,
  race: StrategyRaceProfile,
): BalancedStintTable {
  const result = simulateStrategy({
    name: `${compound} benchmark stint`,
    startCompound: compound,
    paceForLap: balancedPace,
  }, race);

  const cumulativeTime = [0];
  for (const lap of result.laps) {
    cumulativeTime.push(
      cumulativeTime[cumulativeTime.length - 1] + lap.lapTime,
    );
  }
  return { laps: result.laps, cumulativeTime };
}

export function benchmarkStrategies(
  race: StrategyRaceProfile,
): BalanceSnapshot {
  if (race.totalLaps < 3) {
    throw new Error('Strategy benchmark requires at least three laps');
  }

  const stintTables = new Map(
    COMPOUNDS.map((compound) => [
      compound,
      balancedStintTable(compound, race),
    ] as const),
  );

  const oneStopResults: StrategyResult[] = [];
  for (const start of COMPOUNDS) {
    for (const next of COMPOUNDS) {
      if (start === next) continue;
      for (let stopAfterLap = 1; stopAfterLap < race.totalLaps; stopAfterLap++) {
        oneStopResults.push(buildCachedStrategy(
          stintTables,
          race,
          start,
          [{ afterLap: stopAfterLap, compound: next }],
        ));
      }
    }
  }

  const twoStopResults: StrategyResult[] = [];
  for (const start of COMPOUNDS) {
    for (const middle of COMPOUNDS) {
      if (start === middle) continue;
      for (const finish of COMPOUNDS) {
        if (middle === finish) continue;
        for (
          let firstStop = 1;
          firstStop < race.totalLaps - 1;
          firstStop++
        ) {
          for (
            let secondStop = firstStop + 1;
            secondStop < race.totalLaps;
            secondStop++
          ) {
            twoStopResults.push(buildCachedStrategy(
              stintTables,
              race,
              start,
              [
                { afterLap: firstStop, compound: middle },
                { afterLap: secondStop, compound: finish },
              ],
            ));
          }
        }
      }
    }
  }

  oneStopResults.sort((a, b) => a.totalTime - b.totalTime);
  twoStopResults.sort((a, b) => a.totalTime - b.totalTime);
  const legalResults = [...oneStopResults, ...twoStopResults]
    .sort((a, b) => a.totalTime - b.totalTime);

  const fastest = legalResults[0];
  const fastestOneStop = oneStopResults[0];
  const fastestTwoStop = twoStopResults[0];
  const second = legalResults[1] ?? fastest;
  const competitiveResults = legalResults.filter(
    (result) => result.totalTime - fastest.totalTime <= 12,
  );

  return {
    fastest,
    fastestOneStop,
    fastestTwoStop,
    oneStopResults,
    twoStopResults,
    legalResults,
    competitiveResults,
    spreadToSecond: second.totalTime - fastest.totalTime,
  };
}

function buildCachedStrategy(
  tables: ReadonlyMap<Compound, BalancedStintTable>,
  race: StrategyRaceProfile,
  startCompound: Compound,
  stops: readonly StrategyStop[],
): StrategyResult {
  let compound = startCompound;
  let previousStopLap = 0;
  let totalTime = 0;
  const laps: SimulatedLap[] = [];
  const usedCompounds = new Set<Compound>([startCompound]);

  for (const stop of stops) {
    appendCachedStint(
      tables.get(compound)!,
      stop.afterLap - previousStopLap,
      previousStopLap,
      laps,
    );
    totalTime += tables.get(compound)!
      .cumulativeTime[stop.afterLap - previousStopLap];
    totalTime += race.pitLossSeconds;
    compound = stop.compound;
    usedCompounds.add(compound);
    previousStopLap = stop.afterLap;
  }

  const finalStintLaps = race.totalLaps - previousStopLap;
  appendCachedStint(
    tables.get(compound)!,
    finalStintLaps,
    previousStopLap,
    laps,
  );
  totalTime += tables.get(compound)!.cumulativeTime[finalStintLaps];

  const route = [startCompound, ...stops.map((stop) => stop.compound)]
    .map((entry) => entry[0])
    .join('→');
  const stopLabel = stops.length === 1
    ? `lap${stops[0].afterLap}`
    : `laps${stops.map((stop) => stop.afterLap).join('/')}`;

  return {
    name: `${route} ${stopLabel}`,
    totalTime,
    legal: usedCompounds.size >= 2,
    usedCompounds,
    laps,
  };
}

function appendCachedStint(
  table: BalancedStintTable,
  stintLaps: number,
  completedLaps: number,
  target: SimulatedLap[],
): void {
  target.push(
    ...table.laps.slice(0, stintLaps).map((lap, index) => ({
      ...lap,
      lap: completedLaps + index + 1,
    })),
  );
}


function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
