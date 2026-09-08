import { createTire, stepTire, type Compound, type PaceMode, type TireState } from './TireModel';

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

const BASE_LAP_SECONDS = 57.5;
const PIT_LOSS_SECONDS = 3.8;
const REPRESENTATIVE_SECONDS_PER_LAP = 22;
const DT = 0.5;

const modeLoad: Record<PaceMode, number> = {
  CONSERVE: 0.48,
  BALANCED: 0.64,
  PUSH: 0.88,
};

// Small direct pace effect; most of the difference still comes from tyre grip.
const modeLapAdjustment: Record<PaceMode, number> = {
  CONSERVE: 0.42,
  BALANCED: 0,
  PUSH: -0.28,
};

export function simulateStrategy(plan: StrategyPlan, totalLaps = 8): StrategyResult {
  let tire = createTire(plan.startCompound);
  const usedCompounds = new Set<Compound>([plan.startCompound]);
  const laps: SimulatedLap[] = [];
  let totalTime = 0;

  for (let lap = 1; lap <= totalLaps; lap++) {
    const pace = plan.paceForLap(lap, tire);
    let gripSum = 0;
    let samples = 0;

    for (let elapsed = 0; elapsed < REPRESENTATIVE_SECONDS_PER_LAP; elapsed += DT) {
      tire = stepTire(tire, pace, modeLoad[pace], DT);
      gripSum += tire.grip;
      samples += 1;
    }

    const gripAverage = gripSum / Math.max(1, samples);
    const lapTime = BASE_LAP_SECONDS / Math.max(0.56, gripAverage) + modeLapAdjustment[pace];
    totalTime += lapTime;
    laps.push({
      lap,
      compound: tire.compound,
      pace,
      lapTime,
      wearAtEnd: tire.wear,
      gripAverage,
    });

    if (plan.stopAfterLap === lap && plan.nextCompound) {
      totalTime += PIT_LOSS_SECONDS;
      tire = createTire(plan.nextCompound);
      usedCompounds.add(plan.nextCompound);
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
  if (tire.wear > 0.68) return 'CONSERVE';
  return 'BALANCED';
}

export function attackFinish(lap: number, tire: TireState): PaceMode {
  if (tire.wear > 0.72) return 'CONSERVE';
  return lap >= 7 ? 'PUSH' : 'BALANCED';
}

export function pushAlways(): PaceMode {
  return 'PUSH';
}

export function benchmarkStrategies(totalLaps = 8): BalanceSnapshot {
  const plans: StrategyPlan[] = [
    { name: 'M→S balanced', startCompound: 'MEDIUM', stopAfterLap: 5, nextCompound: 'SOFT', paceForLap: attackFinish },
    { name: 'S→M early', startCompound: 'SOFT', stopAfterLap: 3, nextCompound: 'MEDIUM', paceForLap: balancedPace },
    { name: 'M→H steady', startCompound: 'MEDIUM', stopAfterLap: 4, nextCompound: 'HARD', paceForLap: balancedPace },
    { name: 'M→S push always', startCompound: 'MEDIUM', stopAfterLap: 4, nextCompound: 'SOFT', paceForLap: pushAlways },
    { name: 'H→S late', startCompound: 'HARD', stopAfterLap: 6, nextCompound: 'SOFT', paceForLap: attackFinish },
  ];

  const legalResults = plans
    .map((plan) => simulateStrategy(plan, totalLaps))
    .filter((result) => result.legal)
    .sort((a, b) => a.totalTime - b.totalTime);

  const fastest = legalResults[0];
  const second = legalResults[1] ?? fastest;
  const competitiveResults = legalResults.filter((result) => result.totalTime - fastest.totalTime <= 7);

  return {
    fastest,
    legalResults,
    competitiveResults,
    spreadToSecond: second.totalTime - fastest.totalTime,
  };
}
