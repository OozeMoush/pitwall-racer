import { describe, expect, it } from 'vitest';
import {
  createTrackLimitPenaltyState,
  registerTrackLimitWarning,
  serveTrackLimitPitPenalty,
} from './TrackLimitPenaltyModel';

describe('TrackLimitPenaltyModel', () => {
  it('awards five seconds on every third warning', () => {
    let state = createTrackLimitPenaltyState();
    state = registerTrackLimitWarning(state).state;
    state = registerTrackLimitWarning(state).state;
    const third = registerTrackLimitWarning(state);
    expect(third.penaltyAwarded).toBe(5);
    expect(third.state.warnings).toBe(0);
    expect(third.state.pendingPitSeconds).toBe(5);
  });

  it('serves accumulated penalties in the pit box', () => {
    let state = createTrackLimitPenaltyState();
    for (let i = 0; i < 6; i++) state = registerTrackLimitWarning(state).state;
    const served = serveTrackLimitPitPenalty(state);
    expect(served.seconds).toBe(10);
    expect(served.state.pendingPitSeconds).toBe(0);
  });
});
