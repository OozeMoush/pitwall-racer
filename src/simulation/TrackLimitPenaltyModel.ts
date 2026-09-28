export interface TrackLimitPenaltyState {
  warnings: number;
  pendingPitSeconds: number;
}

export interface TrackLimitWarningResult {
  state: TrackLimitPenaltyState;
  penaltyAwarded: number;
}

export const WARNINGS_PER_PENALTY = 5;
const PIT_PENALTY_SECONDS = 5;

export function createTrackLimitPenaltyState(): TrackLimitPenaltyState {
  return { warnings: 0, pendingPitSeconds: 0 };
}

export function registerTrackLimitWarning(
  state: TrackLimitPenaltyState,
): TrackLimitWarningResult {
  const warnings = state.warnings + 1;
  if (warnings < WARNINGS_PER_PENALTY) {
    return { state: { ...state, warnings }, penaltyAwarded: 0 };
  }
  return {
    state: {
      warnings: 0,
      pendingPitSeconds: state.pendingPitSeconds + PIT_PENALTY_SECONDS,
    },
    penaltyAwarded: PIT_PENALTY_SECONDS,
  };
}

export function serveTrackLimitPitPenalty(
  state: TrackLimitPenaltyState,
): { state: TrackLimitPenaltyState; seconds: number } {
  return {
    state: { ...state, pendingPitSeconds: 0 },
    seconds: state.pendingPitSeconds,
  };
}
