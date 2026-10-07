import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, expect, it } from 'vitest';
import { setActiveTrack } from '../TrackModel';
import { runPair } from './PairPassingHarness';

beforeAll(async () => { await RAPIER.init(); setActiveTrack('pitwall-gp'); });

// Research measurement, deliberately not a claim that the rollout gate passed.
it('measures matched colliding pairs through straight, braking, corner and exit', () => {
  for (const scenario of ['slower', 'defends', 'equal'] as const) {
    const before = runPair(false, scenario);
    const after = runPair(true, scenario);
    const repeated = runPair(true, scenario);
    const { controllerMs: _afterCost, ...afterPhysics } = after;
    const { controllerMs: _repeatCost, ...repeatedPhysics } = repeated;
    expect(repeatedPhysics).toEqual(afterPhysics);
    const blockers = [
      ...(after.contactEpisodes > 0 ? ['contact'] : []),
      ...(after.offroadSeconds > 0 ? ['road-envelope'] : []),
      ...(after.stallSeconds > 0 ? ['stall'] : []),
      ...(after.phases.includes('COMMIT') && after.returns === 0 ? ['incomplete-return'] : []),
    ];
    console.log(`PAIR_PASSING_METRICS ${JSON.stringify({ scenario, before, after, blockers })}`);
    for (const metrics of [before, after]) {
      expect(metrics.samples).toBe(1440);
      expect(metrics.distance).toBeGreaterThan(100);
      expect(Number.isFinite(metrics.controllerMs)).toBe(true);
      expect(metrics.turningSeconds).toBeGreaterThan(0);
    }
    // The candidate must actually exercise braking. The unchanged baseline can
    // clear the first corner without >10% brake in the scripted defensive case.
    expect(after.brakingSeconds).toBeGreaterThan(0);
    // Safety is measured and reported, NOT silently asserted to have passed.
    // Promotion requires zero contacts/offroad/stalls plus successful returns
    // in the documented envelope and an independent human pair playtest.
    // Keep the failed candidate reproducible. A successor must deliberately
    // replace this rejection assertion and document new safety evidence.
    expect(blockers).toContain('incomplete-return');
  }
}, 60_000);
