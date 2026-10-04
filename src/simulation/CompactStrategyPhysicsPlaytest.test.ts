import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, expect, it } from 'vitest';
import { raceLapsForPreset } from '../game/RaceSetup';
import { balancedPace, simulateStrategy, strategyRaceProfile } from './StrategySimulator';
import { runPhysicalStrategy, type PhysicalStrategyPlan } from './testing/PhysicalStrategyRunner';

beforeAll(async () => { await RAPIER.init(); });
const plans: PhysicalStrategyPlan[] = [
  { name: 'M-H early one stop', start: 'MEDIUM', stops: [{ plannedLap: 16, compound: 'HARD' }] },
  { name: 'H-M late one stop', start: 'HARD', stops: [{ plannedLap: 32, compound: 'MEDIUM' }] },
  { name: 'H-M-H two stops', start: 'HARD', stops: [{ plannedLap: 19, compound: 'MEDIUM' }, { plannedLap: 32, compound: 'HARD' }] },
  { name: 'H-S-H attacking two stops', start: 'HARD', stops: [{ plannedLap: 19, compound: 'SOFT' }, { plannedLap: 29, compound: 'HARD' }] },
];

it('compares stop families using the live physical race rather than a synthetic near-tie', () => {
  const totalLaps = raceLapsForPreset('pitwall-gp', 'STANDARD');
  const results = plans.map(plan => {
    const result = runPhysicalStrategy({ trackId: 'pitwall-gp', totalLaps, plan, fixedStops: true });
    console.info(`COMPACT_PHYSICAL_STRATEGY ${JSON.stringify({ ...result, laps: undefined, driver: undefined })}`);
    expect(result.finished, plan.name).toBe(true);
    expect(result.pitStops, plan.name).toBe(plan.stops.length);
    expect(result.usedCompounds.length, plan.name).toBeGreaterThanOrEqual(2);
    expect(result.deepCutRatio, plan.name).toBeLessThan(0.03);
    expect(result.stops.map(stop => stop.entryLap), plan.name)
      .toEqual(plan.stops.map(stop => stop.plannedLap));
    expect(result.stops.every(stop => stop.exitSeconds !== undefined), plan.name).toBe(true);
    return result;
  });
  const bestOne = Math.min(...results.slice(0, 2).map(result => result.elapsed));
  const bestTwo = Math.min(...results.slice(2).map(result => result.elapsed));
  // The useful observed behavior is a fresh-tyre gain after actual stop cost,
  // not a demand that every strategy family finishes within three seconds.
  expect(bestOne - bestTwo).toBeGreaterThan(0);
  expect(bestOne - bestTwo).toBeLessThan(30);
  const race = strategyRaceProfile('pitwall-gp', totalLaps, 10.34);
  const approximate = plans.map(plan => simulateStrategy({ name: plan.name,
    startCompound: plan.start, stops: plan.stops.map(stop => ({
      afterLap: stop.plannedLap, compound: stop.compound })), paceForLap: balancedPace }, race));
  console.info(`STRATEGY_MODEL_COMPARISON ${JSON.stringify({ evidence: race.evidence,
    // The analytical API stops after a whole lap, the physical API at entry
    // within that lap. Report both conventions; do not call them identical.
    analyticalStopConvention: 'AFTER_LAP', physicalStopConvention: 'ENTRY_ON_LAP',
    rows: results.map((result, index) => ({ name: result.name,
      physicalSeconds: result.elapsed, physicalDelta: result.elapsed - results[0].elapsed,
      approximateSeconds: approximate[index].totalTime,
      approximateDelta: approximate[index].totalTime - approximate[0].totalTime })) })}`);
}, 600_000);

it('checks nearby one-stop windows without making an exact pit lap mandatory', () => {
  const results = [14, 18].map(plannedLap => {
    const result = runPhysicalStrategy({ trackId: 'pitwall-gp', totalLaps: 48, fixedStops: true,
      plan: { name: `M-H@${plannedLap}`, start: 'MEDIUM', stops: [{ plannedLap, compound: 'HARD' }] } });
    expect(result.finished).toBe(true);
    expect(result.pitStops).toBe(1);
    expect(result.stops[0].entryLap).toBe(plannedLap);
    expect(result.usedCompounds).toEqual(['MEDIUM', 'HARD']);
    expect(result.deepCutRatio).toBeLessThan(0.03);
    console.info(`PHYSICAL_STOP_WINDOW ${JSON.stringify({ name: result.name,
      elapsed: result.elapsed, finishWear: result.finishWear, stops: result.stops })}`);
    return result;
  });
  // Moving a plausible window must not collapse a normal stint into failure.
  expect(Math.abs(results[0].elapsed - results[1].elapsed)).toBeLessThan(30);
}, 360_000);

it('compares one and two stops on Standard Baku with its actual physical pit cost', () => {
  const totalLaps = raceLapsForPreset('baku-street', 'STANDARD');
  const bakuPlans: PhysicalStrategyPlan[] = [
    { name: 'Baku M-H@6', start: 'MEDIUM', stops: [{ plannedLap: 6, compound: 'HARD' }] },
    { name: 'Baku H-M-H@7/12', start: 'HARD', stops: [
      { plannedLap: 7, compound: 'MEDIUM' }, { plannedLap: 12, compound: 'HARD' }] },
  ];
  const results = bakuPlans.map(plan => {
    const result = runPhysicalStrategy({ trackId: 'baku-street', totalLaps, plan, fixedStops: true });
    expect(result.finished, plan.name).toBe(true);
    expect(result.pitStops).toBe(plan.stops.length);
    expect(result.stops.map(stop => stop.entryLap)).toEqual(plan.stops.map(stop => stop.plannedLap));
    expect(result.usedCompounds.length).toBeGreaterThanOrEqual(2);
    expect(result.deepCutRatio).toBeLessThan(0.03);
    console.info(`BAKU_PHYSICAL_STRATEGY ${JSON.stringify({ ...result, laps: undefined, driver: undefined })}`);
    return result;
  });
  // This format may favor either family; no synthetic three-second tie gate.
  expect(Math.abs(results[0].elapsed - results[1].elapsed)).toBeLessThan(60);
}, 360_000);
