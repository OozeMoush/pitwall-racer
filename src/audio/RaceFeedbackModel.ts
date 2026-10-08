export type RaceCue = 'POSITION_UP' | 'POSITION_DOWN' | 'PIT_DONE' | 'BEST' | 'FINISH';
export interface FeedbackState {
  phase: string; lap: number; position: number; pitPhase: string; best?: number;
}

/** Reads observed race truth. Uses simulation time, no event backlog or wall-clock timers. */
export class RaceFeedbackTracker {
  private previous?: FeedbackState;
  private position = 0;
  private candidate = 0;
  private candidateSince = 0;
  private lastCueTime = -Infinity;
  private serviced = false;

  reset(): void {
    this.previous = undefined; this.position = 0; this.candidate = 0;
    this.candidateSince = 0; this.lastCueTime = -Infinity; this.serviced = false;
  }

  update(state: FeedbackState, time: number): RaceCue | undefined {
    if (!Number.isFinite(time)) return;
    const old = this.previous;
    this.previous = { ...state };
    if (!old) { this.position = state.position; this.candidate = state.position; this.candidateSince = time; return; }
    if (state.phase === 'FINISHED' && old.phase !== 'FINISHED') {
      this.lastCueTime = time; return 'FINISH';
    }
    if (state.phase !== 'RACING' || old.phase !== 'RACING' || state.lap < 1) {
      this.position = state.position; this.candidate = state.position; this.candidateSince = time; return;
    }
    let cue: RaceCue | undefined;
    if (state.pitPhase === 'SERVICE') this.serviced = true;
    if (this.serviced && old.pitPhase === 'TRANSIT_OUT' && state.pitPhase === 'IDLE') {
      this.serviced = false; cue = 'PIT_DONE';
    }
    if (state.best !== undefined && Number.isFinite(state.best) && state.best > 0
      && (old.best === undefined || state.best < old.best - 0.00001)) cue ??= 'BEST';
    if (state.position !== this.candidate) { this.candidate = state.position; this.candidateSince = time; }
    if (this.candidate > 0 && this.candidate !== this.position && time - this.candidateSince >= 0.75) {
      cue ??= this.candidate < this.position ? 'POSITION_UP' : 'POSITION_DOWN';
      this.position = this.candidate;
    }
    // Quiet spacing. Suppressed cues are consumed, never replayed later.
    if (cue && time - this.lastCueTime >= 2) { this.lastCueTime = time; return cue; }
  }
}

export function raceCueLabel(cue: RaceCue): string {
  return { POSITION_UP: 'POSITION GAINED', POSITION_DOWN: 'POSITION LOST',
    PIT_DONE: 'PIT EXIT', BEST: 'SESSION BEST', FINISH: 'RACE COMPLETE' }[cue];
}
