import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, expect, it } from 'vitest';
import { getActiveTrack, EDITOR_TRACK_ID, registerEditorTrack, setActiveTrack } from '../TrackModel';
import { runPair, type PairSeed } from './PairPassingHarness';
beforeAll(async () => { await RAPIER.init(); setActiveTrack('pitwall-gp'); });
const seeds: PairSeed[] = [
  { gap: 28, egoSpeed: 75, rivalSpeed: 65 },
  { gap: 60, egoSpeed: 75, rivalSpeed: 65 },
  { gap: 40, egoSpeed: 90, rivalSpeed: 50 },
  { progress: 0.05, gap: 40, egoSpeed: 75, rivalSpeed: 65 },
  { progress: 0.12, gap: 40, egoSpeed: 75, rivalSpeed: 65 },
];
it('measures additional initial-condition risks before promotion', () => {
  for (const seed of seeds) {
    const result = runPair('corridor', 'late', 20, seed);
    const repeated = runPair('corridor', 'late', 20, seed);
    const { controllerMs: _cost, ...physical } = result;
    const { controllerMs: _repeat, ...repeatPhysical } = repeated;
    expect(repeatPhysical).toEqual(physical);
    expect(result.passes).toBe(1);
    expect(result.returns).toBe(1);
    expect(result.returnAt[0]).toBeLessThan(18);
    console.log(`CORRIDOR_ROBUSTNESS ${JSON.stringify({ seed, result })}`);
    expect(result.samples).toBe(2400);
    expect(result.contactEpisodes).toBe(0);
    expect(result.offroadSeconds).toBe(0);
    expect(result.stallSeconds).toBe(0);
  }
}, 60_000);

it('declines a pass on a physically narrowed Pitwall geometry', () => {
  const original = getActiveTrack();
  registerEditorTrack({ ...original, id: EDITOR_TRACK_ID, name: 'NARROW PAIR FIXTURE',
    roadHalfWidths: original.controls.map(() => 8) });
  setActiveTrack(EDITOR_TRACK_ID);
  try {
    const result = runPair('corridor', 'slower', 20, { egoSpeed: 50, rivalSpeed: 50 });
    expect(result.passes).toBe(0);
    expect(result.phases).toEqual([]);
    expect(result.minSeparation).toBeGreaterThan(18);
    console.log(`NARROW_CORRIDOR ${JSON.stringify(result)}`);
    expect(result.samples).toBe(2400);
    expect(result.contactEpisodes).toBe(0);
    expect(result.offroadSeconds).toBe(0);
    expect(result.stallSeconds).toBe(0);
  } finally { setActiveTrack('pitwall-gp'); }
}, 60_000);
