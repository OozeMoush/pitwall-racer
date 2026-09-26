import { describe, expect, it } from 'vitest';
import {
  LIGHTS_OUT_HOLD_MAX_SECONDS,
  LIGHTS_OUT_HOLD_MIN_SECONDS,
  START_LIGHT_FIRST_SECONDS,
  START_LIGHT_INTERVAL_SECONDS,
  START_LIGHTS_ALL_ON_SECONDS,
  createRaceFlow,
  finishRaceFlow,
  raceBanner,
  raceStartLightCount,
  stepRaceFlow,
} from './RaceFlow';

describe('RaceFlow', () => {
  it('lights five reds in sequence before a randomized lights-out hold', () => {
    let flow = createRaceFlow(() => 0);
    expect(flow.phase).toBe('COUNTDOWN');
    expect(raceStartLightCount(flow)).toBe(0);
    expect(flow.startSequenceDuration).toBeCloseTo(
      START_LIGHTS_ALL_ON_SECONDS + LIGHTS_OUT_HOLD_MIN_SECONDS,
      6,
    );

    flow = stepRaceFlow(flow, START_LIGHT_FIRST_SECONDS + 0.001);
    expect(raceStartLightCount(flow)).toBe(1);
    expect(raceBanner(flow)).toBe('RED_1');

    flow = stepRaceFlow(flow, START_LIGHT_INTERVAL_SECONDS * 4);
    expect(raceStartLightCount(flow)).toBe(5);
    expect(raceBanner(flow)).toBe('RED_5');

    flow = stepRaceFlow(flow, LIGHTS_OUT_HOLD_MIN_SECONDS + 0.01);
    expect(flow.phase).toBe('RACING');
    expect(raceBanner(flow)).toBe('LIGHTS_OUT');

    flow = stepRaceFlow(flow, 0.8);
    expect(raceBanner(flow)).toBeUndefined();
  });

  it('varies only the final all-red hold, not the five-light cadence', () => {
    const earliest = createRaceFlow(() => 0);
    const latest = createRaceFlow(() => 1);

    expect(
      (latest.startSequenceDuration ?? 0) - (earliest.startSequenceDuration ?? 0),
    ).toBeCloseTo(
      LIGHTS_OUT_HOLD_MAX_SECONDS - LIGHTS_OUT_HOLD_MIN_SECONDS,
      6,
    );

    const allOnElapsed = START_LIGHTS_ALL_ON_SECONDS + 0.001;
    expect(raceStartLightCount(stepRaceFlow(earliest, allOnElapsed))).toBe(5);
    expect(raceStartLightCount(stepRaceFlow(latest, allOnElapsed))).toBe(5);
  });

  it('freezes into FINISHED until the scene is restarted', () => {
    const start = createRaceFlow(() => 0);
    const flow = finishRaceFlow(stepRaceFlow(start, start.countdown));
    expect(flow.phase).toBe('FINISHED');
    expect(stepRaceFlow(flow, 10)).toEqual(flow);
  });
});
