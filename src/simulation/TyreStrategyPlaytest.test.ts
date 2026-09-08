import { describe, expect, it } from 'vitest';
import { simulateStrategy, type StrategyPlan } from './StrategySimulator';

const plans: StrategyPlan[] = [
  {
    name: 'M no stop',
    startCompound: 'MEDIUM',
    paceForLap: () => 'BALANCED',
  },
  {
    name: 'M→S lap4',
    startCompound: 'MEDIUM',
    stopAfterLap: 4,
    nextCompound: 'SOFT',
    paceForLap: () => 'BALANCED',
  },
  {
    name: 'S→M lap3',
    startCompound: 'SOFT',
    stopAfterLap: 3,
    nextCompound: 'MEDIUM',
    paceForLap: () => 'BALANCED',
  },
  {
    name: 'H→S lap6',
    startCompound: 'HARD',
    stopAfterLap: 6,
    nextCompound: 'SOFT',
    paceForLap: () => 'BALANCED',
  },
];

describe('tyre strategy playtest telemetry', () => {
  it('makes the pit decision pay in pace, not only in the rule book', () => {
    const results = plans.map((plan) => simulateStrategy(plan));
    const noStop = results[0];
    const legal = results.slice(1).sort((a, b) => a.totalTime - b.totalTime);
    const bestLegal = legal[0];

    const metrics = {
      noStopSeconds: Number(noStop.totalTime.toFixed(2)),
      bestLegal: bestLegal.name,
      bestLegalSeconds: Number(bestLegal.totalTime.toFixed(2)),
      pitBenefitSeconds: Number((noStop.totalTime - bestLegal.totalTime).toFixed(2)),
      noStopLap2Grip: Number(noStop.laps[1].gripAverage.toFixed(3)),
      noStopLap5Grip: Number(noStop.laps[4].gripAverage.toFixed(3)),
      noStopLap8Grip: Number(noStop.laps[7].gripAverage.toFixed(3)),
      noStopLap8Wear: Number(noStop.laps[7].wearAtEnd.toFixed(3)),
      strategySpreadSeconds: Number((legal.at(-1)!.totalTime - bestLegal.totalTime).toFixed(2)),
    };

    console.log(`TYRE_PLAYTEST_METRICS ${JSON.stringify(metrics)}`);

    // Pitting must be a pace decision too, but not a 100-second mandatory reset.
    expect(metrics.pitBenefitSeconds).toBeGreaterThan(8);
    expect(metrics.pitBenefitSeconds).toBeLessThan(45);
    expect(metrics.noStopLap8Grip).toBeLessThan(metrics.noStopLap2Grip * 0.85);
    expect(metrics.noStopLap8Wear).toBeGreaterThanOrEqual(0.75);
    // Several plans can differ, while the separate benchmark test protects at
    // least two genuinely competitive legal strategies.
    expect(metrics.strategySpreadSeconds).toBeLessThan(35);
  });
});
