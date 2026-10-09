import RAPIER from '@dimforge/rapier2d-compat';
import { beforeAll, expect, it } from 'vitest';
import { sampleTrack, setActiveTrack, TRACK_LENGTH } from '../TrackModel';
import { runPair, type PairSeed } from './PairPassingHarness';
beforeAll(async () => { await RAPIER.init(); setActiveTrack('pitwall-gp'); });
function measured(scenario: Parameters<typeof runPair>[1], seconds: number, seed: PairSeed = {}) {
  const result = runPair('defense', scenario, seconds, seed);
  const repeated = runPair('defense', scenario, seconds, seed);
  const { controllerMs: _cost, ...physical } = result;
  const { controllerMs: _repeatCost, ...repeatPhysics } = repeated;
  expect(repeatPhysics).toEqual(physical);
  expect(Number.isFinite(result.controllerMs)).toBe(true);
  expect(result.controllerMs).toBeLessThan(5); // broad cost guard, not browser FPS
  console.log('DEFENSIVE_RACECRAFT ' + JSON.stringify({ scenario, seed, result }));
  return result;
}
function safe(result: ReturnType<typeof runPair>) {
  expect(result.contactEpisodes).toBe(0);
  expect(result.offroadSeconds).toBe(0);
  expect(result.stallSeconds).toBe(0);
}
it('early defence on either side brakes, abandons and returns before reconsidering', () => {
  for (const side of [-1, 1]) {
    const seed = { rivalLane: -side * 0.2, blockLane: side * 6 };
    const before = runPair('corridor', 'early-block', 5, seed);
    const result = measured('early-block', 5, seed);
    console.log('EARLY_DEFENCE_COMPARISON ' + JSON.stringify({ side, before, result }));
    safe(result);
    expect(result.aborts).toBe(1);
    expect(result.passes).toBe(0);
    expect(result.returns).toBe(1);
    expect(result.returnAt[0]).toBeLessThan(3);
    const defended = result.trace.find(sample => sample.reason === 'early defence');
    expect(defended).toBeDefined();
    expect(defended!.gap).toBeGreaterThan(20);
    // The brake command is immediate; real speed cannot jump at detection.
    const slowed = result.trace.find(sample => sample.reason === 'early defence'
      && sample.speed < sample.opponentSpeed && sample.time < defended!.time + 0.5);
    expect(slowed).toBeDefined();
    const settled = result.trace.find(sample => sample.phase === 'FOLLOW');
    expect(settled!.gap).toBeGreaterThan(defended!.gap + 5);
    expect(result.trace.every(sample => side * sample.lane > -1)).toBe(true);
    expect(before.aborts).toBe(0); // old policy continues rather than granting the block
  }
}, 60_000);
it('a defence on the other side still leaves a usable passing opportunity', () => {
  const result = measured('defends', 20);
  safe(result);
  expect(result.passes).toBe(1);
  expect(result.returnAt[0]).toBeLessThan(18);
}, 60_000);
it('uses the outside of an approaching corner after a clear slowing mistake', () => {
  const seed = { progress: 0.20, rivalSpeed: 45 };
  const before = runPair('corridor', 'mistake', 20, seed);
  const result = measured('mistake', 20, seed);
  console.log('SLOWING_MISTAKE_COMPARISON ' + JSON.stringify({ before, result }));
  safe(result);
  expect(result.passes).toBe(1);
  expect(result.returnAt[0]).toBeLessThan(18);
  expect(result.cornerOverlapSeconds).toBeGreaterThan(0.8);
  const turn = sampleTrack(seed.progress + 250 / TRACK_LENGTH).heading - sampleTrack(seed.progress).heading;
  const alongside = result.trace.find(sample => sample.phase === 'ALONGSIDE');
  expect(alongside).toBeDefined();
  expect(Math.sign(alongside!.lane - alongside!.opponentLane)).toBe(-Math.sign(turn));
}, 60_000);
it('keeps both physical sides through genuine corner overlap and completes the return', () => {
  for (const egoLane of [-7, 7]) {
    const result = measured('overlap', 12, { progress: 0.28, gap: 0, egoLane, egoSpeed: 55, rivalSpeed: 55 });
    safe(result);
    expect(result.cornerOverlapSeconds).toBeGreaterThan(1);
    expect(result.returns).toBe(1);
    expect(result.returnAt[0]).toBeLessThan(10);
    for (const sample of result.trace.filter(s => s.phase === 'ALONGSIDE')) {
      expect(Math.sign(egoLane) * (sample.lane - sample.opponentLane)).toBeGreaterThan(5.5);
    }
  }
}, 60_000);
it('abandons a marginal attack before a corner and physically settles behind', () => {
  const result = measured('equal', 20);
  safe(result);
  expect(result.passes).toBe(0);
  expect(result.aborts).toBe(1);
  expect(result.returnAt[0]).toBeLessThan(18);
}, 60_000);
it('declines new attacks without preparation distance near the corner', () => {
  for (const progress of [0.24, 0.26, 0.28]) {
    const result = measured('mistake', 20, { progress, rivalSpeed: 45 });
    safe(result);
    expect(result.phases).toEqual([]);
    expect(result.passes).toBe(0);
  }
}, 60_000);
it('records a late human squeeze separately, after measured physical overlap', () => {
  const control = measured('slower', 20);
  const result = measured('squeeze', 20);
  safe(control);
  expect(result.squeezeAt).not.toBeNull();
  expect(Math.abs(result.squeezeGap!)).toBeLessThan(8.3);
  expect(result.contactEpisodes).toBeGreaterThan(0); // preserved physical squeeze counterexample
  expect(result.contacts.every(contact => contact.time > result.squeezeAt!)).toBe(true);
  expect(result.offroadSeconds).toBe(0);
  expect(result.returnAt[0]).toBeLessThan(18);
}, 60_000);
