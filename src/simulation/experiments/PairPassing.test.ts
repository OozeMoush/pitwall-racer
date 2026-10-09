import { describe, expect, it } from 'vitest';
import { PairPassing, type PassingInput } from './PairPassing';

const input: PassingInput = { dt: 1 / 120, gap: 40, speed: 75, opponentSpeed: 65,
  lane: 0, opponentLane: 0, referenceLane: 0, safeLane: 13, straight: true };

describe('isolated pair passing policy', () => {
  it('commits one side with a bounded target rate and holds space when alongside', () => {
    const policy = new PairPassing();
    let previous = 0;
    for (let tick = 0; tick < 360; tick++) {
      const next = policy.step({ ...input, gap: tick > 240 ? 0 : 40, lane: previous });
      expect(Math.abs(next.lane - previous)).toBeLessThanOrEqual(2.5 / 120 + 1e-10);
      expect(next.lane).toBeLessThanOrEqual(0);
      previous = next.lane;
    }
    expect(policy.phase).toBe('ALONGSIDE');
    expect(previous).toBe(-7);
  });
  it('does not launch in braking/corner or insufficient space', () => {
    expect(new PairPassing().step({ ...input, straight: false }).phase).toBe('FOLLOW');
    expect(new PairPassing().step({ ...input, safeLane: 6 }).phase).toBe('FOLLOW');
  });
  it('abandons a failed move, yields longitudinally, and merges only after clearance', () => {
    const policy = new PairPassing();
    policy.step(input);
    for (let tick = 0; tick < 800; tick++) policy.step({ ...input, lane: -7, gap: 0 });
    const abort = policy.step({ ...input, gap: 0, lane: -7 });
    expect(abort.phase).toBe('ABORT');
    expect(abort.lane).toBe(-7);
    expect(abort.speedCap).toBe(57);
    expect(policy.step({ ...input, gap: 25, lane: -7 }).phase).toBe('RETURN');
    let lane = -7;
    for (let tick = 0; tick < 360; tick++) lane = policy.step({ ...input, gap: 25, lane }).lane;
    expect(policy.phase).toBe('FOLLOW');
    expect(Math.abs(lane)).toBeLessThan(0.25);
  });
  it('suspends a successful return if the rival draws alongside again', () => {
    const policy = new PairPassing();
    for (let tick = 0; tick < 360; tick++) policy.step({ ...input, lane: -7 });
    expect(policy.step({ ...input, gap: -25, lane: -7 }).phase).toBe('RETURN');
    const held = policy.step({ ...input, gap: -5, lane: -7 });
    expect(held.lane).toBe(-7);
  });
});
