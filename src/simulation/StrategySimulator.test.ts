import { describe, expect, it } from 'vitest';
import { benchmarkStrategies, pushAlways, simulateStrategy, type StrategyPlan } from './StrategySimulator';

const balanced: StrategyPlan = {
  name: 'balanced M→H',
  startCompound: 'MEDIUM',
  stopAfterLap: 18,
  nextCompound: 'HARD',
  paceForLap: () => 'BALANCED',
};

const push: StrategyPlan = {
  name: 'push M→H',
  startCompound: 'MEDIUM',
  stopAfterLap: 18,
  nextCompound: 'HARD',
  paceForLap: pushAlways,
};

const noStopMedium: StrategyPlan = {
  name: 'medium no stop',
  startCompound: 'MEDIUM',
  paceForLap: () => 'BALANCED',
};

describe('StrategySimulator', () => {
  it('keeps the dry two-compound rule as a hard legality constraint', () => {
    expect(simulateStrategy(noStopMedium).legal).toBe(false);
    expect(simulateStrategy(balanced).legal).toBe(true);
  });

  it('keeps a representative 50-lap one-stop inside useful tyre life', () => {
    const result = simulateStrategy(balanced);
    const mediumStop = result.laps[17];
    const hardFinish = result.laps[49];

    expect(mediumStop.compound).toBe('MEDIUM');
    expect(mediumStop.wearAtEnd).toBeGreaterThan(0.30);
    expect(mediumStop.wearAtEnd).toBeLessThan(0.62);
    expect(hardFinish.compound).toBe('HARD');
    expect(hardFinish.wearAtEnd).toBeGreaterThan(0.25);
    expect(hardFinish.wearAtEnd).toBeLessThan(0.60);
  });

  it('makes PUSH buy opening pace by spending materially more tyre', () => {
    const balancedResult = simulateStrategy(balanced);
    const pushResult = simulateStrategy(push);

    expect(pushResult.laps[0].lapTime).toBeLessThan(balancedResult.laps[0].lapTime);
    expect(pushResult.laps[5].wearAtEnd).toBeGreaterThan(balancedResult.laps[5].wearAtEnd * 1.8);
  });

  it('keeps many one-stop windows race-relevant at the default 50 laps', () => {
    const snapshot = benchmarkStrategies(50);

    expect(snapshot.competitiveResults.length).toBeGreaterThanOrEqual(12);
    expect(snapshot.spreadToSecond).toBeLessThan(2);
    expect(snapshot.fastest.usedCompounds.has('HARD')).toBe(true);
    expect(snapshot.fastest.usedCompounds.has('MEDIUM')).toBe(true);
  });

  it('keeps Soft viable in the 40-lap race without making it dominant at 60 laps', () => {
    const shortRace = benchmarkStrategies(40);
    const longRace = benchmarkStrategies(60);
    const shortSoft = shortRace.legalResults.find((result) => result.usedCompounds.has('SOFT'));
    const longSoft = longRace.legalResults.find((result) => result.usedCompounds.has('SOFT'));

    expect(shortSoft).toBeDefined();
    expect((shortSoft?.totalTime ?? Infinity) - shortRace.fastest.totalTime).toBeLessThan(12);
    expect(longRace.fastest.usedCompounds.has('HARD')).toBe(true);
    expect((longSoft?.totalTime ?? Infinity) - longRace.fastest.totalTime).toBeGreaterThan(15);
  });

  it('does not let an illegal no-stop run win by bypassing the tyre rule', () => {
    const snapshot = benchmarkStrategies();
    expect(snapshot.fastest.legal).toBe(true);
    expect(snapshot.fastest.usedCompounds.size).toBeGreaterThanOrEqual(2);
  });
});
