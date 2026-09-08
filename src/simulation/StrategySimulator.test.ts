import { describe, expect, it } from 'vitest';
import { benchmarkStrategies, pushAlways, simulateStrategy, type StrategyPlan } from './StrategySimulator';

const balanced: StrategyPlan = {
  name: 'balanced',
  startCompound: 'MEDIUM',
  stopAfterLap: 4,
  nextCompound: 'SOFT',
  paceForLap: () => 'BALANCED',
};

const push: StrategyPlan = {
  name: 'push',
  startCompound: 'MEDIUM',
  stopAfterLap: 4,
  nextCompound: 'SOFT',
  paceForLap: pushAlways,
};

describe('StrategySimulator', () => {
  it('keeps the dry two-compound rule as a hard legality constraint', () => {
    const illegal = simulateStrategy({
      name: 'one tyre all race',
      startCompound: 'MEDIUM',
      paceForLap: () => 'BALANCED',
    });
    const legal = simulateStrategy(balanced);

    expect(illegal.legal).toBe(false);
    expect(legal.legal).toBe(true);
  });

  it('makes PUSH buy opening pace by spending materially more tyre', () => {
    const balancedResult = simulateStrategy(balanced);
    const pushResult = simulateStrategy(push);

    expect(pushResult.laps[0].lapTime).toBeLessThan(balancedResult.laps[0].lapTime);
    expect(pushResult.laps[3].wearAtEnd).toBeGreaterThan(balancedResult.laps[3].wearAtEnd * 1.35);
  });

  it('keeps multiple legal strategies within a race-relevant window', () => {
    const snapshot = benchmarkStrategies();

    expect(snapshot.legalResults.length).toBeGreaterThanOrEqual(5);
    expect(snapshot.competitiveResults.length).toBeGreaterThanOrEqual(2);
    expect(snapshot.spreadToSecond).toBeLessThan(7);
  });

  it('does not let an illegal no-stop run win by bypassing the tyre rule', () => {
    const snapshot = benchmarkStrategies();
    expect(snapshot.fastest.legal).toBe(true);
    expect(snapshot.fastest.usedCompounds.size).toBeGreaterThanOrEqual(2);
  });
});
