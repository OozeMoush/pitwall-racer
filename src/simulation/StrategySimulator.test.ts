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

const TOTAL_LAPS = raceLapsForPreset('baku-street', 'STANDARD');
const RACE = strategyRaceProfile('baku-street', TOTAL_LAPS);

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

  it('keeps compact one-stop and two-stop economics coherent', () => {
    const compactLaps = raceLapsForPreset('serra-circuit', 'STANDARD');
    const compactRace = strategyRaceProfile('serra-circuit', compactLaps);
    const snapshot = benchmarkStrategies(compactRace);
    const oneTwoGap = Math.abs(
      snapshot.fastestOneStop.totalTime - snapshot.fastestTwoStop.totalTime,
    );

    expect(compactLaps).toBeGreaterThan(60);
    expect(compactRace.representativeLapSeconds).toBeCloseTo(23.119, 6);
    expect(compactRace.totalLaps * compactRace.representativeLapSeconds / 60)
      .toBeGreaterThan(26);
    expect(compactRace.totalLaps * compactRace.representativeLapSeconds / 60)
      .toBeLessThan(28);
    expect(compactRace.pitLossSeconds).toBeGreaterThanOrEqual(4);
    expect(compactRace.pitLossSeconds).toBeLessThanOrEqual(7);
    expect(compactRace.strategyEffectScale).toBeGreaterThan(0.05);
    expect(compactRace.strategyEffectScale).toBeLessThan(0.10);
    expect(oneTwoGap).toBeLessThan(3);
    expect(snapshot.fastestOneStop.legal).toBe(true);
    expect(snapshot.fastestTwoStop.legal).toBe(true);
  });

  it('charges pit-time changes per stop without changing tyre pace or wear', () => {
    const laps = raceLapsForPreset('pitwall-gp', 'STANDARD');
    const cheap = strategyRaceProfile('pitwall-gp', laps, 6);
    const costly = strategyRaceProfile('pitwall-gp', laps, 20);
    const snapshot = benchmarkStrategies(cheap);
    const oneStop: StrategyPlan = {
      name: 'one', startCompound: 'MEDIUM',
      stops: [{ afterLap: 16, compound: 'HARD' }], paceForLap: balancedPace,
    };
    const twoStop: StrategyPlan = {
      name: 'two', startCompound: 'HARD',
      stops: [{ afterLap: 19, compound: 'MEDIUM' }, { afterLap: 32, compound: 'HARD' }],
      paceForLap: balancedPace,
    };
    expect(cheap.strategyEffectScale).toBe(costly.strategyEffectScale);
    for (const [plan, count] of [[oneStop, 1], [twoStop, 2]] as const) {
      const a = simulateStrategy(plan, cheap);
      const b = simulateStrategy(plan, costly);
      expect(b.totalTime - a.totalTime).toBeCloseTo(14 * count, 8);
      expect(a.laps).toEqual(b.laps);
    }
    expect(snapshot.fastestOneStop.legal).toBe(true);
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
