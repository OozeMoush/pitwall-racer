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


it('bypasses a stopped car instead of waiting indefinitely on an open straight', () => {
  for (const seed of [
    { gap: 22, egoSpeed: 0, rivalSpeed: 0 },
    { gap: 28, egoSpeed: 0, rivalSpeed: 0 },
  ]) {
    const result = runPair('corridor', 'stopped', 20, seed);
    const repeated = runPair('corridor', 'stopped', 20, seed);
    const { controllerMs: _cost, ...physical } = result;
    const { controllerMs: _repeat, ...repeatPhysical } = repeated;
    expect(repeatPhysical).toEqual(physical);
    console.log(`STOPPED_CORRIDOR ${JSON.stringify({ seed, result })}`);
    expect(result.contactEpisodes).toBe(0);
    expect(result.offroadSeconds).toBe(0);
    expect(result.passes).toBe(1);
    expect(result.returns).toBe(1);
    expect(result.returnAt[0]).toBeLessThan(18);
    expect(result.finalEgoSpeed).toBeGreaterThan(5);
  }
}, 60_000);

it('waits when a bypass does not fit and restarts when the front car leaves', () => {
  const original = getActiveTrack();
  registerEditorTrack({ ...original, id: EDITOR_TRACK_ID, name: 'NARROW STOP FIXTURE',
    roadHalfWidths: original.controls.map(() => 8) });
  setActiveTrack(EDITOR_TRACK_ID);
  try {
    const waiting = runPair('corridor', 'stopped', 6, { gap: 22, egoSpeed: 0, rivalSpeed: 0 });
    const result = runPair('corridor', 'restart', 15, { gap: 22, egoSpeed: 0, rivalSpeed: 0 });
    console.log(`RESTART_CORRIDOR ${JSON.stringify({ waiting, result })}`);
    expect(waiting.phases).toEqual([]);
    expect(waiting.distance).toBeLessThan(4);
    expect(waiting.finalEgoSpeed).toBeLessThan(1);
    expect(waiting.minSeparation).toBeGreaterThan(18);
    expect(result.contactEpisodes).toBe(0);
    expect(result.offroadSeconds).toBe(0);
    expect(result.restartDistance).toBeGreaterThan(100);
    expect(result.finalEgoSpeed).toBeGreaterThan(5);
  } finally { setActiveTrack('pitwall-gp'); }
}, 60_000);


it('brakes for a sudden stop and recovers when a close obstacle moves away', () => {
  const seed = { gap: 40, egoSpeed: 65, rivalSpeed: 65 };
  const result = runPair('corridor', 'restart', 30, seed);
  console.log(`EMERGENCY_RESTART ${JSON.stringify(result)}`);
  expect(result.contactEpisodes).toBe(0);
  expect(result.offroadSeconds).toBe(0);
  expect(result.restartDistance).toBeGreaterThan(100);
  expect(result.finalEgoSpeed).toBeGreaterThan(5);
  expect(result.returns).toBeGreaterThan(0);
}, 60_000);
