export type RacePhase = 'COUNTDOWN' | 'RACING' | 'FINISHED';

export interface RaceFlowState {
  phase: RacePhase;
  countdown: number;
  goFlash: number;
}

export function createRaceFlow(): RaceFlowState {
  return { phase: 'COUNTDOWN', countdown: 3, goFlash: 0 };
}

export function stepRaceFlow(state: RaceFlowState, dt: number): RaceFlowState {
  if (state.phase === 'COUNTDOWN') {
    const countdown = Math.max(0, state.countdown - dt);
    if (countdown === 0) return { phase: 'RACING', countdown: 0, goFlash: 0.75 };
    return { ...state, countdown };
  }

  if (state.phase === 'RACING' && state.goFlash > 0) {
    return { ...state, goFlash: Math.max(0, state.goFlash - dt) };
  }

  return state;
}

export function finishRaceFlow(state: RaceFlowState): RaceFlowState {
  return { ...state, phase: 'FINISHED', countdown: 0, goFlash: 0 };
}

export function raceBanner(state: RaceFlowState): string | undefined {
  if (state.phase === 'COUNTDOWN') return String(Math.max(1, Math.ceil(state.countdown)));
  if (state.phase === 'RACING' && state.goFlash > 0) return 'GO';
  return undefined;
}
