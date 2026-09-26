import { describe, expect, it } from 'vitest';
import { simulateStrategy, type StrategyPlan } from './StrategySimulator';

const TOTAL_LAPS = 50;
const plans: StrategyPlan[] = [
  {
    name: 'M no stop',
    startCompound: 'MEDIUM',
    paceForLap: () => 'BALANCED',
  },
  {
    name: 'M→H lap18',
    startCompound: 'MEDIUM',
    stopAfterLap: 18,
    nextCompound: 'HARD',
    paceForLap: () => 'BALANCED',
  },
  {
    name: 'H→M lap32',
    startCompound: 'HARD',
    stopAfterLap: 32,
    nextCompound: 'MEDIUM',
    paceForLap: () => 'BALANCED',
  },
  {
    name: 'S→H lap11',
    startCompound: 'SOFT',
    stopAfterLap: 11,
    nextCompound: 'HARD',
    paceForLap: () => 'BALANCED',
  },
];

describe('tyre strategy playtest telemetry', () => {
  it('keeps the default 50-lap race strategically meaningful on current tyre scale', () => {
    const results = plans.map((plan) => simulateStrategy(plan, TOTAL_LAPS));
    const noStop = results[0];
    const legal = results.slice(1).sort((a, b) => a.totalTime - b.totalTime);
    const bestLegal = legal[0];
    const secondLegal = legal[1] ?? bestLegal;
    const softAttack = legal.find((result) => result.name.startsWith('S→'))!;

    const mediumHard = results[1];
    const mediumStop = mediumHard.laps[17];
    const hardFinish = mediumHard.laps[49];

    const metrics = {
      noStopSeconds: Number(noStop.totalTime.toFixed(2)),
      bestLegal: bestLegal.name,
      bestLegalSeconds: Number(bestLegal.totalTime.toFixed(2)),
      secondLegal: secondLegal.name,
      secondBestGapSeconds: Number((secondLegal.totalTime - bestLegal.totalTime).toFixed(2)),
      noStopPenaltySeconds: Number((noStop.totalTime - bestLegal.totalTime).toFixed(2)),
      softAttackGapSeconds: Number((softAttack.totalTime - bestLegal.totalTime).toFixed(2)),
      mediumStopWear: Number(mediumStop.wearAtEnd.toFixed(3)),
      hardFinishWear: Number(hardFinish.wearAtEnd.toFixed(3)),
      noStopLap20Wear: Number(noStop.laps[19].wearAtEnd.toFixed(3)),
      noStopLap50Wear: Number(noStop.laps[49].wearAtEnd.toFixed(3)),
    };

    console.log(`TYRE_PLAYTEST_METRICS ${JSON.stringify(metrics)}`);

    // A no-stop Medium is both illegal and physically a terrible 50-lap idea.
    expect(metrics.noStopPenaltySeconds).toBeGreaterThan(120);
    expect(metrics.noStopLap50Wear).toBeGreaterThan(0.95);

    // Two opposite M/H stint orders should remain genuinely competitive.
    expect(metrics.secondBestGapSeconds).toBeLessThan(5);

    // Soft remains a usable attacking start rather than a completely dead choice.
    expect(metrics.softAttackGapSeconds).toBeGreaterThan(0);
    expect(metrics.softAttackGapSeconds).toBeLessThan(25);

    // The representative live-style stop windows should occur before the cliff.
    expect(metrics.mediumStopWear).toBeGreaterThan(0.30);
    expect(metrics.mediumStopWear).toBeLessThan(0.62);
    expect(metrics.hardFinishWear).toBeGreaterThan(0.25);
    expect(metrics.hardFinishWear).toBeLessThan(0.60);
    expect(metrics.noStopLap20Wear).toBeGreaterThan(0.40);
    expect(metrics.noStopLap20Wear).toBeLessThan(0.65);
  });
});
