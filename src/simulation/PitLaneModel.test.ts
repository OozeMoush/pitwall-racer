import { afterEach, describe, expect, it } from 'vitest';
import {
  PIT_BOX_T,
  PIT_ENTRY_MIN_LANE_OFFSET,
  PIT_SERVICE_SECONDS,
  PIT_SPEED,
  beginPitStop,
  isPitActive,
  pitBoxTForSlot,
  pitEntryProgress,
  pitExitProgress,
  pitLaneLengthMetres,
  pitLaneOffset,
  pitLanePose,
  pitLaneSpeedLimitActive,
  pitLaneTargetSpeed,
  pitStopDurationSeconds,
  projectPitLane,
  shouldEnterPit,
  stepPitStop,
  stepPlayerPitStop,
} from './PitLaneModel';
import { TRACK_ROAD_HALF_WIDTH } from './TrackLimitsModel';
import { setActiveTrack } from './TrackModel';

afterEach(() => setActiveTrack('pitwall-gp'));

describe('PitLaneModel', () => {
  it('only commits a requested player that actually takes the pit-entry side', () => {
    const entryProgress = pitEntryProgress();
    const before = entryProgress - 0.01;
    const after = entryProgress + 0.001;
    expect(shouldEnterPit(before, after, 20, true, PIT_ENTRY_MIN_LANE_OFFSET + 1)).toBe(true);
    expect(shouldEnterPit(before, after, 20, true, PIT_ENTRY_MIN_LANE_OFFSET - 1)).toBe(false);
    expect(shouldEnterPit(before, after, 20, false, PIT_ENTRY_MIN_LANE_OFFSET + 1)).toBe(false);
    expect(shouldEnterPit(before, after, 100, true, PIT_ENTRY_MIN_LANE_OFFSET + 1)).toBe(false);
  });

  it('keeps the AI time-based state machine and changes tyres once', () => {
    let state = beginPitStop();
    expect(isPitActive(state)).toBe(true);

    for (let i = 0; i < 5000 && state.phase === 'TRANSIT_IN'; i++) {
      state = stepPitStop(state, 1 / 120);
    }
    expect(state.phase).toBe('SERVICE');
    expect(state.t).toBe(PIT_BOX_T);

    for (let i = 0; i < 500 && state.phase === 'SERVICE'; i++) {
      state = stepPitStop(state, 1 / 120);
    }
    expect(state.phase).toBe('TRANSIT_OUT');
    expect(state.tyreChanged).toBe(true);

    for (let i = 0; i < 5000 && state.phase === 'TRANSIT_OUT'; i++) {
      state = stepPitStop(state, 1 / 120);
    }
    expect(state.phase).toBe('DONE');
    expect(state.t).toBe(1);
  });

  it('advances the player pit only when the car moves along the physical path', () => {
    let state = beginPitStop();
    state = stepPlayerPitStop(state, 1 / 120, PIT_BOX_T - 0.03);
    expect(state.phase).toBe('TRANSIT_IN');
    state = stepPlayerPitStop(state, 1 / 120, PIT_BOX_T);
    expect(state.phase).toBe('SERVICE');

    for (let i = 0; i < 500 && state.phase === 'SERVICE'; i++) {
      state = stepPlayerPitStop(state, 1 / 120, state.t);
    }
    expect(state.phase).toBe('TRANSIT_OUT');
    state = stepPlayerPitStop(state, 1 / 120, 0.999);
    expect(state.phase).toBe('DONE');
  });

  it('projects exact pit-path poses back onto the same pit progress', () => {
    const pose = pitLanePose(0.43);
    const projected = projectPitLane(pose.x, pose.y, 0.40);
    expect(projected.t).toBeCloseTo(0.43, 2);
    expect(projected.distance).toBeLessThan(0.2);
  });

  it('uses an 80 km/h limiter and slows progressively into the box', () => {
    expect(PIT_SPEED * 3.6).toBeCloseTo(80, 3);
    expect(pitLaneSpeedLimitActive(0.5)).toBe(true);
    expect(pitLaneSpeedLimitActive(0.02)).toBe(false);

    const state = beginPitStop();
    expect(pitLaneTargetSpeed(state, state.boxT - 0.01))
      .toBeLessThan(pitLaneTargetSpeed(state, state.boxT - 0.08));
  });

  it('keeps different cars on different longitudinal pit boxes', () => {
    expect(pitBoxTForSlot(1)).toBeGreaterThan(pitBoxTForSlot(0));
    expect(pitBoxTForSlot(7)).toBeGreaterThan(pitBoxTForSlot(6));
  });

  it('uses per-circuit physical pit lengths instead of a lap percentage', () => {
    setActiveTrack('pitwall-gp');
    const pitwallLength = pitLaneLengthMetres();
    const pitwallDuration = pitStopDurationSeconds();
    const pitwallExit = pitExitProgress();
    expect(pitwallLength).toBeCloseTo(480, 6);
    expect(pitEntryProgress()).toBeCloseTo(0.985, 6);

    setActiveTrack('baku-street');
    expect(pitLaneLengthMetres()).toBeCloseTo(480, 6);
    expect(pitStopDurationSeconds()).toBeCloseTo(pitwallDuration, 6);
    expect(pitEntryProgress()).toBeCloseTo(0.985, 6);
    // Similar physical pit length, different circuit geometry/length.
    expect(pitExitProgress()).not.toBeCloseTo(pitwallExit, 3);
  });

  it('makes the pit lane a substantial strategy cost', () => {
    expect(PIT_SERVICE_SECONDS).toBeGreaterThanOrEqual(2.3);
    expect(pitStopDurationSeconds()).toBeGreaterThan(14);
    expect(pitStopDurationSeconds()).toBeLessThan(25);
  });

  it('moves outside the racing surface and rejoins through the dedicated openings', () => {
    expect(pitLaneOffset(0)).toBeLessThan(pitLaneOffset(0.5));
    expect(pitLaneOffset(1)).toBeLessThan(pitLaneOffset(0.5));

    const entry = pitLanePose(0);
    const middle = pitLanePose(0.5);
    const exit = pitLanePose(1);
    expect(entry.raceProgress).toBeGreaterThan(0.9);
    expect(middle.laneOffset).toBeGreaterThan(TRACK_ROAD_HALF_WIDTH);
    expect(exit.raceProgress).toBeLessThan(0.1);
  });
});
