import { describe, expect, it } from 'vitest';
import { benchmarkStrategies, pushAlways, simulateStrategy, type StrategyPlan } from './StrategySimulator';

const balanced: StrategyPlan = {
  name: 'balanced',
  startCompound: 'MEDIUM',
  stopAfterLap: 8,
  nextCompound: 'SOFT',
  paceForLap: () => 'BALANCED',
};

const push: StrategyPlan = {
  name: 'push',
  startCompound: 'MEDIUM',
  stopAfterLap: 8,
  nextCompound: 'SOFT',
  paceForLap: pushAlways,
};

const noStopMedium: StrategyPlan = {
  name: 'medium no stop',
  startCompound: 'MEDIUM',
  paceForLap: () => 'BALANCED',
};

describe('StrategySimulator', () => {
  it('keeps the dry two-compound rule as a hard legality constraint', () => {
    const illegal = simulateStrategy(noStopMedium);
    const legal = simulateStrategy(balanced);

    expect(illegal.legal).toBe(false);
    expect(legal.legal).toBe(true);
  });

  it('makes a sensible stop faster than nursing one Medium set to the flag even before legality', () => {
    const noStop = simulateStrategy(noStopMedium);
    const oneStop = simulateStrategy(balanced);

    expect(oneStop.totalTime).toBeLessThan(noStop.totalTime - 8);
    expect(noStop.laps[11].gripAverage).toBeLessThan(noStop.laps[3].gripAverage * 0.80);
    expect(noStop.laps[7].gripAverage).toBeGreaterThan(noStop.laps[3].gripAverage * 0.88);
  });

  it('makes PUSH buy opening pace by spending materially more tyre', () => {
    const balancedResult = simulateStrategy(balanced);
    const pushResult = simulateStrategy(push);

    expect(pushResult.laps[0].lapTime).toBeLessThan(balancedResult.laps[0].lapTime);
    expect(pushResult.laps[5].wearAtEnd).toBeGreaterThan(balancedResult.laps[5].wearAtEnd * 1.35);
  });

  it('keeps multiple legal strategies race-relevant at twelve laps', () => {
    const snapshot = benchmarkStrategies(12);
    const bestHard = snapshot.legalResults.find((result) => result.usedCompounds.has('HARD'));

    expect(snapshot.competitiveResults.length).toBeGreaterThanOrEqual(3);
    expect(snapshot.spreadToSecond).toBeLessThan(6);
    expect(bestHard).toBeDefined();
    expect((bestHard?.totalTime ?? Infinity) - snapshot.fastest.totalTime).toBeLessThan(8);
  });

  it('makes Hard a genuine winning option in the longest selectable race', () => {
    const snapshot = benchmarkStrategies(16);
    expect(snapshot.fastest.usedCompounds.has('HARD')).toBe(true);
    expect(snapshot.competitiveResults.some((result) => result.usedCompounds.has('SOFT') && result.usedCompounds.has('MEDIUM'))).toBe(true);
  });

  it('does not let an illegal no-stop run win by bypassing the tyre rule', () => {
    const snapshot = benchmarkStrategies();
    expect(snapshot.fastest.legal).toBe(true);
    expect(snapshot.fastest.usedCompounds.size).toBeGreaterThanOrEqual(2);
  });
});
