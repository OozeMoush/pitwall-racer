import { describe, expect, it } from 'vitest';
import {
  createTrackLimitPenaltyState,
  registerTrackLimitWarning,
  serveTrackLimitPitPenalty,
} from './TrackLimitPenaltyModel';

describe('TrackLimitPenaltyModel', () => {
  it('awards five seconds on every fifth warning', () => {
    let state = createTrackLimitPenaltyState();
    for (let i = 0; i < 4; i++) {
      const warning = registerTrackLimitWarning(state);
      expect(warning.penaltyAwarded).toBe(0);
      state = warning.state;
    }
    const fifth = registerTrackLimitWarning(state);
    expect(fifth.penaltyAwarded).toBe(5);
    expect(fifth.state.warnings).toBe(0);
    expect(fifth.state.pendingPitSeconds).toBe(5);
  });

  it('serves accumulated penalties in the pit box', () => {
    let state = createTrackLimitPenaltyState();
    for (let i = 0; i < 10; i++) state = registerTrackLimitWarning(state).state;
    const served = serveTrackLimitPitPenalty(state);
    expect(served.seconds).toBe(10);
    expect(served.state.pendingPitSeconds).toBe(0);
  });
});
