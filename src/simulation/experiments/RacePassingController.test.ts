import { afterEach, expect, it } from 'vitest';
import { RacePassingController, physicalTrafficGap } from './RacePassingController';
import { createAiField, type RaceTrafficCar } from '../RaceModel';
import { dynamicAiControl } from '../DynamicAiController';
import { setRuntimeRacingLine } from '../RacingLineRuntime';
import { sampleTrack, setActiveTrack, TRACK_LENGTH } from '../TrackModel';
import { createVehicle } from '../VehicleModel';
const driver = { ...createAiField()[1], progress: 0.04, lap: 1, pitPlan: [] };
function run(extra: RaceTrafficCar[] = [], policy = new RacePassingController()) {
  setActiveTrack('pitwall-gp');
  const pose = sampleTrack(driver.progress);
  const car = { ...createVehicle(pose.x, pose.y, pose.heading), speed: 75 };
  const rival: RaceTrafficCar = { id: 'player', lap: 0, progress: driver.progress + 40 / TRACK_LENGTH,
    speed: 65, laneOffset: 0, performance: 1, isPlayer: true };
  const base = dynamicAiControl(driver, car, [rival, ...extra]);
  return { control: policy.control(driver, car, [rival, ...extra], base, 1 / 120), policy, base };
}
afterEach(() => { setRuntimeRacingLine('pitwall-gp', undefined); setActiveTrack('pitwall-gp'); });
it('uses physical lapped neighbours across the circuit seam', () => {
  const result = run();
  expect(result.policy.snapshot()).toMatchObject({ phase: 'COMMIT', rivalId: 'player' });
  expect(result.control.targetLane).not.toBe(result.base.targetLane);
  expect(physicalTrafficGap(0.99, 0.01)).toBeCloseTo(0.02 * TRACK_LENGTH);
  expect(physicalTrafficGap(0.01, 0.99)).toBeCloseTo(-0.02 * TRACK_LENGTH);
});
it('does not launch when other traffic reserves both passing lanes', () => {
  const reservations = [-7, 7].map((laneOffset, index) => ({ id: `peer${index}`, lap: 1,
    progress: driver.progress + 70 / TRACK_LENGTH, speed: 65, laneOffset, performance: 1 }));
  const result = run(reservations);
  expect(result.policy.snapshot().phase).toBe('FOLLOW');
});
it('excludes off-track bodies', () => {
  const remote = [{ id: 'off-track', lap: 1, progress: driver.progress + 20 / TRACK_LENGTH,
    speed: 0, laneOffset: 260, performance: 1 }];
  expect(run(remote).policy.snapshot().rivalId).toBe('player');
});
it('resets state and retains the baseline for explicit PLAYER lines', () => {
  const policy = run().policy;
  setRuntimeRacingLine('pitwall-gp', { version: 1, trackId: 'pitwall-gp', source: 'PLAYER',
    referenceGrip: 1.76, points: Array.from({ length: 100 }, (_, i) => ({ progress: i / 100, laneOffset: 0, targetSpeed: 70 })) });
  const result = run([], policy);
  expect(result.control).toBe(result.base);
  expect(policy.snapshot().phase).toBe('FOLLOW');
});

it('leaves the grid launch to the baseline before racing speed', () => {
  setActiveTrack('pitwall-gp');
  const pose = sampleTrack(driver.progress);
  const car = { ...createVehicle(pose.x, pose.y, pose.heading), speed: 15 };
  const traffic = [{ id: 'peer', lap: 1, progress: driver.progress, speed: 15, laneOffset: 7, performance: 1 }];
  const base = dynamicAiControl(driver, car, traffic), policy = new RacePassingController();
  expect(policy.control(driver, car, traffic, base, 1 / 120)).toBe(base);
  expect(policy.snapshot().phase).toBe('FOLLOW');
});
