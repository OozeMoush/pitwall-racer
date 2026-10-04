import RAPIER from '@dimforge/rapier2d-compat';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { createAiField } from './RaceModel';
import { pitEntryProgress } from './PitLaneModel';
import { createTire, LATE_TIRE_WEAR_START } from './TireModel';
import { setActiveTrack, TRACK_LENGTH } from './TrackModel';
import { runPhysicalStrategy } from './testing/PhysicalStrategyRunner';

beforeAll(async () => { await RAPIER.init(); });
afterEach(() => setActiveTrack('pitwall-gp'));

it.each([0.45, 0.60])('compares physical traffic decisions at starting wear %s', wear => {
  setActiveTrack('pitwall-gp');
  const start = { lap: 12, progress: pitEntryProgress() - 260 / TRACK_LENGTH, speed: 88, wear };
  const plan = { name: 'traffic window M-H', start: 'MEDIUM' as const,
    stops: [{ plannedLap: 14, compound: 'HARD' as const }] };
  const [base] = createAiField(undefined, 48);
  const rival = { ...base, id: 'ai-1', name: 'TRAFFIC', skill: 1.110,
    lap: start.lap, progress: start.progress + 14 / TRACK_LENGTH, speed: 70,
    laneOffset: 0, tire: { ...createTire('HARD'), wear: 0.65 },
    pitPlan: [], pitLap: 999, plannedPitLap: 999, pitStopIndex: 0 };
  const clear = runPhysicalStrategy({ trackId: 'pitwall-gp', totalLaps: 48,
    plan, start, maxSeconds: 120 });
  const traffic = runPhysicalStrategy({ trackId: 'pitwall-gp', totalLaps: 48,
    plan, start, rivals: [rival], maxSeconds: 120 });
  const late = runPhysicalStrategy({ trackId: 'pitwall-gp', totalLaps: 48,
    plan, start, fixedStops: true, rivals: [{ ...rival, tire: { ...rival.tire },
      usedCompounds: new Set(rival.usedCompounds) }], maxSeconds: 120 });
  console.info(`PHYSICAL_TRAFFIC_STOP ${JSON.stringify({ wear, clear: { stops: clear.stops,
    followingSeconds: clear.followingSeconds, deepCutRatio: clear.deepCutRatio },
    traffic: { stops: traffic.stops, followingSeconds: traffic.followingSeconds,
      deepCutRatio: traffic.deepCutRatio }, late: { stops: late.stops,
      followingSeconds: late.followingSeconds },
    distanceGainLaps: traffic.driver.lap + traffic.driver.progress - late.driver.lap - late.driver.progress })}`);
  expect(clear.stops).toHaveLength(1);
  expect(traffic.stops).toHaveLength(1);
  expect(clear.stops[0].entryLap).toBe(14);
  expect(traffic.stops[0].entryLap).toBe(wear < LATE_TIRE_WEAR_START ? 14 : 12);
  expect(traffic.stops[0].exitSeconds).toBeDefined();
  expect(traffic.pitStops).toBe(1);
  expect(traffic.usedCompounds).toEqual(['MEDIUM', 'HARD']);
  expect(traffic.deepCutRatio).toBeLessThan(0.03);
  if (wear < LATE_TIRE_WEAR_START) expect(clear.deepCutRatio).toBeLessThan(0.03);
  expect(late.stops[0].entryLap).toBe(14);
  expect(late.stops[0].exitSeconds).toBeDefined();
  const distanceGain = traffic.driver.lap + traffic.driver.progress - late.driver.lap - late.driver.progress;
  if (wear < LATE_TIRE_WEAR_START) {
    expect(late.deepCutRatio).toBeLessThan(0.03);
    expect(distanceGain).toBeCloseTo(0, 6);
  } else {
    // This deliberately worn/late control enters the tyre cliff. Require the
    // early stop to improve both physical progress and its path-error outcome.
    expect(distanceGain).toBeGreaterThan(0.10);
    expect(traffic.deepCutRatio).toBeLessThan(clear.deepCutRatio);
    expect(traffic.deepCutRatio).toBeLessThan(late.deepCutRatio);
  }
}, 60_000);
