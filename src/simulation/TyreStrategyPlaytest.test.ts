import { describe, expect, it } from 'vitest';
import { simulateStrategy, type StrategyPlan } from './StrategySimulator';

const TOTAL_LAPS = 12;
const plans: StrategyPlan[] = [
  {
    name: 'M no stop',
    startCompound: 'MEDIUM',
    paceForLap: () => 'BALANCED',
  },
  {
    name: 'M→S lap8',
    startCompound: 'MEDIUM',
    stopAfterLap: 8,
    nextCompound: 'SOFT',
    paceForLap: () => 'BALANCED',
  },
  {
    name: 'S→M lap4',
    startCompound: 'SOFT',
    stopAfterLap: 4,
    nextCompound: 'MEDIUM',
    paceForLap: () => 'BALANCED',
  },
  {
    name: 'H→S lap8',
    startCompound: 'HARD',
    stopAfterLap: 8,
    nextCompound: 'SOFT',
    paceForLap: () => 'BALANCED',
  },
  {
    name: 'S→H lap4',
    startCompound: 'SOFT',
    stopAfterLap: 4,
    nextCompound: 'HARD',
    paceForLap: () => 'BALANCED',
  },
];

describe('tyre strategy playtest telemetry', () => {
  it('makes a twelve-lap pit decision pay in pace, not only in the rule book', () => {
    const results = plans.map((plan) => simulateStrategy(plan, TOTAL_LAPS));
    const noStop = results[0];
    const legal = results.slice(1).sort((a, b) => a.totalTime - b.totalTime);
    const bestLegal = legal[0];
    const secondLegal = legal[1] ?? bestLegal;

    const metrics = {
      noStopSeconds: Number(noStop.totalTime.toFixed(2)),
      bestLegal: bestLegal.name,
      bestLegalSeconds: Number(bestLegal.totalTime.toFixed(2)),
      secondLegal: secondLegal.name,
      secondBestGapSeconds: Number((secondLegal.totalTime - bestLegal.totalTime).toFixed(2)),
      pitBenefitSeconds: Number((noStop.totalTime - bestLegal.totalTime).toFixed(2)),
      noStopLap4Grip: Number(noStop.laps[3].gripAverage.toFixed(3)),
      noStopLap8Grip: Number(noStop.laps[7].gripAverage.toFixed(3)),
      noStopLap12Grip: Number(noStop.laps[11].gripAverage.toFixed(3)),
      noStopLap12Wear: Number(noStop.laps[11].wearAtEnd.toFixed(3)),
    };

    console.log(`TYRE_PLAYTEST_METRICS ${JSON.stringify(metrics)}`);

    expect(metrics.pitBenefitSeconds).toBeGreaterThan(20);
    expect(metrics.pitBenefitSeconds).toBeLessThan(120);
    expect(metrics.noStopLap8Grip).toBeGreaterThan(metrics.noStopLap4Grip * 0.88);
    expect(metrics.noStopLap12Grip).toBeLessThan(metrics.noStopLap4Grip * 0.72);
    expect(metrics.noStopLap12Wear).toBeGreaterThanOrEqual(0.68);
    expect(metrics.noStopLap12Wear).toBeLessThan(0.90);
    expect(metrics.secondBestGapSeconds).toBeLessThan(30);
  });
});
