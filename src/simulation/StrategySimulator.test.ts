import { describe, expect, it } from 'vitest';
import { raceLapsForPreset } from '../game/RaceSetup';
import {
  balancedPace,
  benchmarkStrategies,
  pushAlways,
  simulateStrategy,
  strategyRaceProfile,
  type StrategyPlan,
} from './StrategySimulator';

const TOTAL_LAPS = raceLapsForPreset('pitwall-gp', 'STANDARD');
const RACE = strategyRaceProfile('pitwall-gp', TOTAL_LAPS);

const balanced: StrategyPlan = {
  name: 'balanced M→H',
  startCompound: 'MEDIUM',
  stops: [{ afterLap: 6, compound: 'HARD' }],
  paceForLap: () => 'BALANCED',
};

const push: StrategyPlan = {
  name: 'push M→H',
  startCompound: 'MEDIUM',
  stops: [{ afterLap: 6, compound: 'HARD' }],
  paceForLap: pushAlways,
};

const noStopMedium: StrategyPlan = {
  name: 'medium no stop',
  startCompound: 'MEDIUM',
  paceForLap: () => 'BALANCED',
};

describe('StrategySimulator', () => {
  it('uses the selected race duration and circuit pace instead of a fixed lap-count era', () => {
    expect(TOTAL_LAPS).toBe(18);
    expect(RACE.representativeLapSeconds).toBe(90);
    expect(RACE.totalLaps * RACE.representativeLapSeconds / 60).toBeCloseTo(27, 6);
    expect(RACE.pitLossSeconds).toBeGreaterThanOrEqual(18);
    expect(RACE.pitLossSeconds).toBeLessThanOrEqual(24);
  });

  it('keeps the dry two-compound rule as a hard legality constraint', () => {
    expect(simulateStrategy(noStopMedium, RACE).legal).toBe(false);
    expect(simulateStrategy(balanced, RACE).legal).toBe(true);
  });

  it('keeps a representative standard-race one-stop inside useful tyre life', () => {
    const result = simulateStrategy(balanced, RACE);
    const mediumStop = result.laps[5];
    const hardFinish = result.laps[result.laps.length - 1];

    expect(mediumStop.compound).toBe('MEDIUM');
    expect(mediumStop.wearAtEnd).toBeGreaterThan(0.45);
    expect(mediumStop.wearAtEnd).toBeLessThan(0.70);
    expect(hardFinish.compound).toBe('HARD');
    expect(hardFinish.wearAtEnd).toBeGreaterThan(0.45);
    expect(hardFinish.wearAtEnd).toBeLessThan(0.70);
  });

  it('makes PUSH buy opening pace by spending materially more tyre', () => {
    const balancedResult = simulateStrategy(balanced, RACE);
    const pushResult = simulateStrategy(push, RACE);

    expect(pushResult.laps[0].lapTime).toBeLessThan(balancedResult.laps[0].lapTime);
    expect(pushResult.laps[3].wearAtEnd).toBeGreaterThan(
      balancedResult.laps[3].wearAtEnd * 1.45,
    );
  });

  it('keeps competitive one-stop and two-stop families in the standard race', () => {
    const snapshot = benchmarkStrategies(RACE);
    const oneTwoGap = Math.abs(
      snapshot.fastestOneStop.totalTime - snapshot.fastestTwoStop.totalTime,
    );

    expect(snapshot.fastest.totalTime / 60).toBeGreaterThan(25);
    expect(snapshot.fastest.totalTime / 60).toBeLessThan(30);
    expect(oneTwoGap).toBeLessThan(3);
    expect(
      snapshot.oneStopResults.filter(
        (result) => result.totalTime - snapshot.fastest.totalTime <= 12,
      ).length,
    ).toBeGreaterThanOrEqual(8);
    expect(
      snapshot.twoStopResults.filter(
        (result) => result.totalTime - snapshot.fastest.totalTime <= 12,
      ).length,
    ).toBeGreaterThanOrEqual(20);
  });

  it('keeps Soft available to a competitive attacking two-stop family', () => {
    const snapshot = benchmarkStrategies(RACE);
    const softTwoStop = snapshot.twoStopResults.find(
      (result) => result.usedCompounds.has('SOFT'),
    );

    expect(softTwoStop).toBeDefined();
    expect((softTwoStop?.totalTime ?? Infinity) - snapshot.fastest.totalTime)
      .toBeLessThan(6);
  });

  it('keeps the cached benchmark numerically identical to direct simulation', () => {
    const snapshot = benchmarkStrategies(RACE);
    const cached = snapshot.oneStopResults.find(
      (result) => result.name === 'M→H lap6',
    );
    const direct = simulateStrategy({
      ...balanced,
      paceForLap: balancedPace,
    }, RACE);

    expect(cached).toBeDefined();
    expect(cached!.totalTime).toBeCloseTo(direct.totalTime, 9);
    expect(cached!.laps).toHaveLength(direct.laps.length);
    expect(cached!.laps[5].wearAtEnd).toBeCloseTo(direct.laps[5].wearAtEnd, 9);
    expect(cached!.laps.at(-1)!.wearAtEnd).toBeCloseTo(direct.laps.at(-1)!.wearAtEnd, 9);
  });

  it('does not let an illegal no-stop run win by bypassing the tyre rule', () => {
    const snapshot = benchmarkStrategies(RACE);
    expect(snapshot.fastest.legal).toBe(true);
    expect(snapshot.fastest.usedCompounds.size).toBeGreaterThanOrEqual(2);
  });
});
