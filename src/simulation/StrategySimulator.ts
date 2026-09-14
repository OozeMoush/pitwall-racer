import { pitStopDurationSeconds } from './PitLaneModel';
import { createTire, gripRatioToMedium, stepTire, type Compound, type PaceMode, type TireState } from './TireModel';
import { REPRESENTATIVE_SLIDE_PENALTY_SECONDS, tyreSlideRisk } from './TyrePerformanceModel';

export interface StrategyPlan {
  name: string;
  startCompound: Compound;
  stopAfterLap?: number;
  nextCompound?: Compound;
  paceForLap: (lap: number, tire: TireState) => PaceMode;
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
  legalResults: StrategyResult[];
  competitiveResults: StrategyResult[];
  spreadToSecond: number;
}

const BASE_LAP_SECONDS = 62;
const REPRESENTATIVE_SECONDS_PER_LAP = 58;
const DT = 0.5;
const CORNER_TIME_FRACTION = 0.45;
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

export function simulateStrategy(plan: StrategyPlan, totalLaps = 12): StrategyResult {
  let tire = createTire(plan.startCompound);
  const usedCompounds = new Set<Compound>([plan.startCompound]);
  const laps: SimulatedLap[] = [];
  let totalTime = 0;

  for (let lap = 1; lap <= totalLaps; lap++) {
    const pace = plan.paceForLap(lap, tire);
    let gripSum = 0;
    let slideRiskSum = 0;
    let samples = 0;

    for (let elapsed = 0; elapsed < REPRESENTATIVE_SECONDS_PER_LAP; elapsed += DT) {
      tire = stepTire(tire, pace, modeLoad[pace], DT);
      gripSum += tire.grip;
      slideRiskSum += tyreSlideRisk(tire.wear);
      samples += 1;
    }

    const gripAverage = gripSum / Math.max(1, samples);
    const slideRiskAverage = slideRiskSum / Math.max(1, samples);
    // Compounds still separate through the cornering share of the lap. Wear is
    // evaluated separately as the expected time cost of short rear-slide
    // events, matching live play: ageing increases how often mistakes happen
    // rather than permanently switching the steering to a worse mode.
    const straightSeconds = BASE_LAP_SECONDS * (1 - CORNER_TIME_FRACTION);
    const cornerSeconds = BASE_LAP_SECONDS * CORNER_TIME_FRACTION;
    const relativeGrip = Math.max(0.56, gripRatioToMedium(gripAverage));
    const lapTime = straightSeconds
      + cornerSeconds / Math.pow(relativeGrip, GRIP_RESPONSE_EXPONENT)
      + slideRiskAverage * REPRESENTATIVE_SLIDE_PENALTY_SECONDS
      + modeLapAdjustment[pace];
    totalTime += lapTime;
    laps.push({ lap, compound: tire.compound, pace, lapTime, wearAtEnd: tire.wear, gripAverage });

    if (plan.stopAfterLap === lap && plan.nextCompound) {
      // Strategy tooling must value a stop exactly like the live race. Keeping
      // this coupled to PitLaneModel prevents future balance passes from making
      // undercuts look cheap in tests while the actual player loses more time.
      totalTime += pitStopDurationSeconds();
      tire = createTire(plan.nextCompound);
      usedCompounds.add(plan.nextCompound);
    }
  }

  return { name: plan.name, totalTime, legal: usedCompounds.size >= 2, usedCompounds, laps };
}

export function balancedPace(_: number, tire: TireState): PaceMode {
  if (tire.wear > 0.72) return 'CONSERVE';
  return 'BALANCED';
}

export function attackFinish(lap: number, tire: TireState): PaceMode {
  if (tire.wear > 0.76) return 'CONSERVE';
  return lap >= 10 ? 'PUSH' : 'BALANCED';
}

export function pushAlways(): PaceMode {
  return 'PUSH';
}

export function benchmarkStrategies(totalLaps = 12): BalanceSnapshot {
  // Evaluate every legal one-stop compound pairing at every possible stop lap.
  // Fixed stop laps hide the value of Hard in a 16-lap race and overstate it in
  // shorter races; the benchmark should measure the best version of each idea.
  const plans: StrategyPlan[] = [];
  for (const start of COMPOUNDS) {
    for (const next of COMPOUNDS) {
      if (start === next) continue;
      for (let stopAfterLap = 1; stopAfterLap < totalLaps; stopAfterLap++) {
        plans.push({
          name: `${start[0]}→${next[0]} lap${stopAfterLap}`,
          startCompound: start,
          stopAfterLap,
          nextCompound: next,
          paceForLap: balancedPace,
        });
      }
    }
  }

  const legalResults = plans
    .map((plan) => simulateStrategy(plan, totalLaps))
    .filter((result) => result.legal)
    .sort((a, b) => a.totalTime - b.totalTime);

  const fastest = legalResults[0];
  const second = legalResults[1] ?? fastest;
  const competitiveResults = legalResults.filter((result) => result.totalTime - fastest.totalTime <= 12);

  return {
    fastest,
    legalResults,
    competitiveResults,
    spreadToSecond: second.totalTime - fastest.totalTime,
  };
}
