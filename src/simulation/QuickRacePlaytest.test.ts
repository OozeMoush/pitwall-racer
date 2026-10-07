import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, expect, it } from 'vitest';
import { raceLapsForPreset } from '../game/RaceSetup';
import { createAiField } from './RaceModel';
import { runPhysicalStrategy } from './testing/PhysicalStrategyRunner';
beforeAll(async () => { await RAPIER.init(); });
it('completes QUICK with adaptive physical single stops on Compact and Standard circuits', () => {
  for (const trackId of ['pitwall-gp', 'baku-street'] as const) {
    const totalLaps = raceLapsForPreset(trackId, 'QUICK');
    for (const index of [0, 2, 4]) {
      const driver = createAiField(undefined, totalLaps, 'QUICK')[index];
      const result = runPhysicalStrategy({ trackId, totalLaps, plan: {
        name: driver.name, start: driver.tire.compound, stops: driver.pitPlan,
      }, maxSeconds: 900 });
      expect(result.finished, `${trackId} ${driver.name}`).toBe(true);
      expect(result.pitStops).toBe(1);
      expect(result.usedCompounds).toHaveLength(2);
      expect(result.stops[0].exitSeconds).toBeDefined();
      expect(result.elapsed).toBeLessThan(900);
      console.info('QUICK_PHYSICAL', JSON.stringify({trackId, driver:driver.name, laps:totalLaps, elapsed:result.elapsed, stops:result.stops}));
    }
  }
}, 120000);
