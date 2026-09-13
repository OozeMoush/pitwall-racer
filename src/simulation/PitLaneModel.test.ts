import { describe, expect, it } from 'vitest';
import {
  PIT_BOX_T,
  PIT_ENTRY_PROGRESS,
  beginPitStop,
  isPitActive,
  pitLaneOffset,
  pitLanePose,
  shouldEnterPit,
  stepPitStop,
} from './PitLaneModel';
import { TRACK_ROAD_HALF_WIDTH } from './TrackLimitsModel';

describe('PitLaneModel', () => {
  it('only captures a requested car that actually reaches pit entry near the track', () => {
    expect(shouldEnterPit(PIT_ENTRY_PROGRESS - 0.01, PIT_ENTRY_PROGRESS + 0.001, 20, true)).toBe(true);
    expect(shouldEnterPit(PIT_ENTRY_PROGRESS - 0.01, PIT_ENTRY_PROGRESS + 0.001, 20, false)).toBe(false);
    expect(shouldEnterPit(PIT_ENTRY_PROGRESS - 0.01, PIT_ENTRY_PROGRESS + 0.001, 100, true)).toBe(false);
  });

  it('runs through transit, service and exit while changing tyres once', () => {
    let state = beginPitStop();
    expect(isPitActive(state)).toBe(true);

    for (let i = 0; i < 2000 && state.phase === 'TRANSIT_IN'; i++) state = stepPitStop(state, 1 / 120);
    expect(state.phase).toBe('SERVICE');
    expect(state.t).toBe(PIT_BOX_T);

    for (let i = 0; i < 500 && state.phase === 'SERVICE'; i++) state = stepPitStop(state, 1 / 120);
    expect(state.phase).toBe('TRANSIT_OUT');
    expect(state.tyreChanged).toBe(true);

    for (let i = 0; i < 2000 && state.phase === 'TRANSIT_OUT'; i++) state = stepPitStop(state, 1 / 120);
    expect(state.phase).toBe('DONE');
    expect(state.t).toBe(1);
  });

  it('moves clearly outside the miniature racing surface and rejoins at the same lap path', () => {
    expect(pitLaneOffset(0)).toBeLessThan(pitLaneOffset(0.5));
    expect(pitLaneOffset(1)).toBeLessThan(pitLaneOffset(0.5));

    const entry = pitLanePose(0);
    const middle = pitLanePose(0.5);
    const exit = pitLanePose(1);
    expect(entry.raceProgress).toBeGreaterThan(0.9);
    expect(middle.laneOffset).toBeGreaterThan(TRACK_ROAD_HALF_WIDTH * 2);
    expect(exit.raceProgress).toBeLessThan(0.1);
  });
});
