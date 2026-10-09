import { expect, it } from 'vitest';
import { DefensePassing } from './DefensePassing';
import type { PassingInput } from './PairPassing';
import { sampleTrack, setActiveTrack } from '../TrackModel';
import { createVehicle } from '../VehicleModel';
const initial: PassingInput = { dt: 1 / 120, gap: 40, speed: 75, opponentSpeed: 65,
  lane: 0, opponentLane: 0, referenceLane: 0, safeLane: 13, straight: true };
function step(policy: DefensePassing, patch: Partial<PassingInput> = {}) {
  setActiveTrack('pitwall-gp');
  const input = { ...initial, ...patch };
  const pose = sampleTrack(0.04, input.lane);
  return policy.step(input, { ...createVehicle(pose.x, pose.y, pose.heading), speed: input.speed }, 0.04, 1);
}
it('an early block brakes and abandons the chosen side rather than chasing a moving opponent', () => {
  for (const opponentLane of [-0.2, 0.2]) {
    const policy = new DefensePassing();
    const first = step(policy, { opponentLane });
    const side = Math.sign(first.lane);
    let plan = first;
    for (let tick = 1; tick < 120; tick++) {
      plan = step(policy, { opponentLane: opponentLane + side * tick / 120 * 5, lane: first.lane, gap: 35 });
      if (plan.phase === 'ABORT') break;
    }
    expect(plan.phase).toBe('ABORT');
    expect(plan.reason).toBe('early defence');
    expect(plan.speed).toBeLessThan(65);
    expect(Math.sign(plan.lane)).toBe(side);
  }
});
it('does not immediately launch the other side after a defensive abort', () => {
  const policy = new DefensePassing();
  const first = step(policy);
  const side = Math.sign(first.lane);
  const aborted = step(policy, { opponentLane: side * 4, gap: 35 });
  expect(aborted.phase).toBe('ABORT');
  let plan = aborted;
  for (let tick = 0; tick < 600 && plan.phase !== 'FOLLOW'; tick++) {
    plan = step(policy, { gap: 60, speed: 55, opponentSpeed: 65, lane: 0 });
  }
  expect(plan.phase).toBe('FOLLOW');
  for (let tick = 0; tick < 240; tick++) expect(step(policy).phase).toBe('FOLLOW');
});
it('reserves the physical side during existing overlap despite a crossing reference line', () => {
  for (const side of [-1, 1]) {
    const policy = new DefensePassing();
    for (let tick = 0; tick < 120; tick++) {
      const plan = step(policy, { gap: 0, lane: side * 7, referenceLane: -side * 5,
        speed: 55, opponentSpeed: 55, straight: false });
      expect(plan.phase).toBe('ALONGSIDE');
      expect(side * plan.lane).toBeGreaterThanOrEqual(7 - 1e-8);
    }
  }
});
it('keeps meaningful slower-car opportunities while declining a closed corner approach', () => {
  expect(step(new DefensePassing(), { opponentSpeed: 45 }).phase).toBe('COMMIT');
  expect(step(new DefensePassing(), { straight: false }).phase).toBe('FOLLOW');
  expect(step(new DefensePassing(), { safeLane: 6 }).phase).toBe('FOLLOW');
});
