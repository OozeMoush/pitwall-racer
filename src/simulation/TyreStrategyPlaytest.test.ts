import { describe, expect, it } from 'vitest';
import { raceLapsForPreset } from '../game/RaceSetup';
import {
  benchmarkStrategies,
  simulateStrategy,
  strategyRaceProfile,
  type StrategyPlan,
} from './StrategySimulator';

const TOTAL_LAPS = raceLapsForPreset('pitwall-gp', 'STANDARD');
const RACE = strategyRaceProfile('pitwall-gp', TOTAL_LAPS);

const plans: StrategyPlan[] = [
  {
    name: 'M no stop',
    startCompound: 'MEDIUM',
    paceForLap: () => 'BALANCED',
  },
  {
    name: 'M→H lap6',
    startCompound: 'MEDIUM',
    stops: [{ afterLap: 6, compound: 'HARD' }],
    paceForLap: () => 'BALANCED',
  },
  {
    name: 'H→M lap12',
    startCompound: 'HARD',
    stops: [{ afterLap: 12, compound: 'MEDIUM' }],
    paceForLap: () => 'BALANCED',
  },
  {
    name: 'H→M→H laps7/11',
    startCompound: 'HARD',
    stops: [
      { afterLap: 7, compound: 'MEDIUM' },
      { afterLap: 11, compound: 'HARD' },
    ],
    paceForLap: () => 'BALANCED',
  },
];

describe('tyre strategy playtest telemetry', () => {
  it('keeps the standard duration race strategically meaningful on race-scale time', () => {
    const results = plans.map((plan) => simulateStrategy(plan, RACE));
    const snapshot = benchmarkStrategies(RACE);
    const noStop = results[0];
    const representativeOneStop = results[1];
    const representativeTwoStop = results[3];
    const softTwoStop = snapshot.twoStopResults.find(
      (result) => result.usedCompounds.has('SOFT'),
    )!;

    const metrics = {
      totalLaps: TOTAL_LAPS,
      referenceRaceMinutes: Number(
        (TOTAL_LAPS * RACE.representativeLapSeconds / 60).toFixed(2),
      ),
      pitLossSeconds: Number(RACE.pitLossSeconds.toFixed(2)),
      fastest: snapshot.fastest.name,
      fastestSeconds: Number(snapshot.fastest.totalTime.toFixed(2)),
      fastestOneStop: snapshot.fastestOneStop.name,
      fastestOneStopSeconds: Number(snapshot.fastestOneStop.totalTime.toFixed(2)),
      fastestTwoStop: snapshot.fastestTwoStop.name,
      fastestTwoStopSeconds: Number(snapshot.fastestTwoStop.totalTime.toFixed(2)),
      oneTwoStopGapSeconds: Number(
        Math.abs(
          snapshot.fastestOneStop.totalTime - snapshot.fastestTwoStop.totalTime,
        ).toFixed(2),
      ),
      softTwoStopGapSeconds: Number(
        (softTwoStop.totalTime - snapshot.fastest.totalTime).toFixed(2),
      ),
      noStopPenaltySeconds: Number(
        (noStop.totalTime - snapshot.fastest.totalTime).toFixed(2),
      ),
      mediumStopWear: Number(representativeOneStop.laps[5].wearAtEnd.toFixed(3)),
      hardFinishWear: Number(representativeOneStop.laps.at(-1)!.wearAtEnd.toFixed(3)),
      representativeTwoStopSeconds: Number(representativeTwoStop.totalTime.toFixed(2)),
      noStopFinishWear: Number(noStop.laps.at(-1)!.wearAtEnd.toFixed(3)),
    };

    console.log(`TYRE_PLAYTEST_METRICS ${JSON.stringify(metrics)}`);

    expect(metrics.referenceRaceMinutes).toBeGreaterThanOrEqual(25);
    expect(metrics.referenceRaceMinutes).toBeLessThanOrEqual(30);
    expect(metrics.pitLossSeconds).toBeGreaterThanOrEqual(18);
    expect(metrics.pitLossSeconds).toBeLessThanOrEqual(24);

    // The mandatory-stop rule has a real physical counterpart: staying on one
    // Medium set to the flag reaches the cliff and loses meaningful race time.
    expect(metrics.noStopPenaltySeconds).toBeGreaterThan(90);
    expect(metrics.noStopFinishWear).toBeGreaterThan(0.95);

    // A normal one-stop and a deliberate two-stop must both be live choices.
    expect(metrics.oneTwoStopGapSeconds).toBeLessThan(3);
    expect(metrics.softTwoStopGapSeconds).toBeLessThan(6);

    // The representative M→H window reaches the stop/finish before either tyre
    // is simply destroyed, leaving room for undercut/overcut movement.
    expect(metrics.mediumStopWear).toBeGreaterThan(0.45);
    expect(metrics.mediumStopWear).toBeLessThan(0.70);
    expect(metrics.hardFinishWear).toBeGreaterThan(0.45);
    expect(metrics.hardFinishWear).toBeLessThan(0.70);
  });
});
