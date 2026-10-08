import { describe, expect, it } from 'vitest';
import { CorridorPassing } from './CorridorPassing';
import { sampleTrack, setActiveTrack } from '../TrackModel';
import { createVehicle } from '../VehicleModel';
import type { PassingInput } from './PairPassing';
const input: PassingInput = { dt: 1 / 120, gap: 40, speed: 75, opponentSpeed: 65,
  lane: 0, opponentLane: 0, referenceLane: 0, safeLane: 13, straight: true };
function step(policy: CorridorPassing, patch: Partial<PassingInput> = {}) {
  setActiveTrack('pitwall-gp');
  const i = { ...input, ...patch };
  const pose = sampleTrack(0.04, i.lane);
  return policy.step(i, { ...createVehicle(pose.x, pose.y, pose.heading), speed: i.speed }, 0.04, 1);
}
describe('reference-relative pair policy', () => {
  it('rejects narrow space and corner entry', () => {
    expect(step(new CorridorPassing(), { safeLane: 6 }).phase).toBe('FOLLOW');
    expect(step(new CorridorPassing(), { straight: false }).phase).toBe('FOLLOW');
  });
  it('limits passing offset change when the reference itself moves', () => {
    const policy = new CorridorPassing();
    let previousOffset = 0;
    for (let tick = 0; tick < 120; tick++) {
      const referenceLane = tick / 120;
      const result = step(policy, { referenceLane, lane: referenceLane + previousOffset });
      const offset = result.lane - referenceLane;
      expect(Math.abs(offset - previousOffset)).toBeLessThanOrEqual(2.5 / 120 + 1e-10);
      expect(Number.isFinite(result.speed)).toBe(true);
      previousOffset = offset;
    }
  });
  it('does not merge across a rival that will catch up during the return', () => {
    const policy = new CorridorPassing();
    let lane = 0;
    for (let tick = 0; tick < 360; tick++) lane = step(policy, { lane }).lane;
    const result = step(policy, { lane, gap: -25, opponentSpeed: 85 });
    expect(result.phase).toBe('RETURN');
    expect(result.lane).toBeCloseTo(-7);
  });
  it('requires physical alignment to remain settled before handing back to FOLLOW', () => {
    const policy = new CorridorPassing();
    step(policy);
    let lane = 0;
    for (let tick = 0; tick < 500; tick++) {
      const result = step(policy, { gap: -100, opponentSpeed: 65, lane: 4 });
      lane = result.lane;
      expect(result.phase).not.toBe('FOLLOW');
    }
    expect(Math.abs(lane)).toBeLessThan(0.25);
    for (let tick = 0; tick < 30; tick++) expect(step(policy, { gap: -100 }).phase).toBe('RETURN');
    for (let tick = 0; tick < 20; tick++) step(policy, { gap: -100 });
    expect(step(policy, { gap: -100 }).phase).toBe('FOLLOW');
  });
});

it('waits briefly before bypassing a stopped car and retains space/corner gates', () => {
  const policy = new CorridorPassing();
  for (let tick = 0; tick < 60; tick++) {
    expect(step(policy, { gap: 22, speed: 0, opponentSpeed: 0 }).phase).toBe('FOLLOW');
  }
  let plan = step(policy, { gap: 22, speed: 0, opponentSpeed: 0 });
  for (let tick = 0; tick < 30; tick++) plan = step(policy, { gap: 22, speed: 0, opponentSpeed: 0 });
  expect(plan.phase).toBe('COMMIT');
  expect(plan.speed).toBeGreaterThan(0);
  expect(plan.speed).toBeLessThanOrEqual(3);
  for (const patch of [{ safeLane: 6 }, { straight: false }, { gap: 9 }, { gap: 18 }]) {
    const waiting = new CorridorPassing();
    for (let tick = 0; tick < 240; tick++) {
      expect(step(waiting, { gap: 22, speed: 0, opponentSpeed: 0, ...patch }).phase).toBe('FOLLOW');
    }
  }
});
