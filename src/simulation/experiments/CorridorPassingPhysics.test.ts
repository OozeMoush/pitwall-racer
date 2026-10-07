import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, expect, it } from 'vitest';
import { setActiveTrack } from '../TrackModel';
import { runPair } from './PairPassingHarness';
beforeAll(async () => { await RAPIER.init(); setActiveTrack('pitwall-gp'); });
it('passes or aborts and settles without contacts, road departures or stalls in the four pair fixtures', () => {
  for (const scenario of ['slower', 'defends', 'equal', 'late'] as const) {
    const before = runPair(false, scenario, 20);
    const legacy = runPair(true, scenario, 20);
    const result = runPair('corridor', scenario, 20);
    const repeated = runPair('corridor', scenario, 20);
    const { controllerMs: _cost, ...physical } = result;
    const { controllerMs: _repeatCost, ...repeatPhysical } = repeated;
    expect(repeatPhysical).toEqual(physical);
    console.log(`CORRIDOR_METRICS ${JSON.stringify({ scenario, before, legacy, result })}`);
    expect(result.samples).toBe(2400);
    expect(result.contactEpisodes).toBe(0);
    expect(result.offroadSeconds).toBe(0);
    expect(result.stallSeconds).toBe(0);
    expect(result.returns).toBe(1);
    expect(result.returnAt[0]).toBeLessThan(18); // leaves at least 2 s after settling
    expect(result.brakingSeconds).toBeGreaterThan(0);
    expect(result.turningSeconds).toBeGreaterThan(0);
    expect(result.passes).toBe(scenario === 'equal' ? 0 : 1);
    if (scenario === 'equal') expect(result.aborts).toBe(1);
    // A broad regression guard only; no FPS claim follows from CPU wall time.
    expect(result.controllerMs).toBeLessThan(5);
  }
}, 60_000);
