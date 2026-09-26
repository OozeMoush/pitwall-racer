export type RacePhase = 'COUNTDOWN' | 'RACING' | 'FINISHED';

export interface RaceFlowState {
  phase: RacePhase;
  countdown: number;
  goFlash: number;
  startSequenceDuration?: number;
}

export const START_LIGHT_FIRST_SECONDS = 0.45;
export const START_LIGHT_INTERVAL_SECONDS = 0.65;
export const START_LIGHT_COUNT = 5;
export const START_LIGHTS_ALL_ON_SECONDS =
  START_LIGHT_FIRST_SECONDS + START_LIGHT_INTERVAL_SECONDS * (START_LIGHT_COUNT - 1);
export const LIGHTS_OUT_HOLD_MIN_SECONDS = 0.65;
export const LIGHTS_OUT_HOLD_MAX_SECONDS = 2.35;

export function createRaceFlow(random: () => number = Math.random): RaceFlowState {
  const hold =
    LIGHTS_OUT_HOLD_MIN_SECONDS
    + clamp01(random()) * (LIGHTS_OUT_HOLD_MAX_SECONDS - LIGHTS_OUT_HOLD_MIN_SECONDS);
  const startSequenceDuration = START_LIGHTS_ALL_ON_SECONDS + hold;
  return {
    phase: 'COUNTDOWN',
    countdown: startSequenceDuration,
    goFlash: 0,
    startSequenceDuration,
  };
}

export function stepRaceFlow(state: RaceFlowState, dt: number): RaceFlowState {
  if (state.phase === 'COUNTDOWN') {
    const countdown = Math.max(0, state.countdown - Math.max(0, dt));
    if (countdown === 0) {
      return {
        phase: 'RACING',
        countdown: 0,
        goFlash: 0.75,
        startSequenceDuration: state.startSequenceDuration,
      };
    }
    return { ...state, countdown };
  }

  if (state.phase === 'RACING' && state.goFlash > 0) {
    return { ...state, goFlash: Math.max(0, state.goFlash - Math.max(0, dt)) };
  }

  return state;
}

export function finishRaceFlow(state: RaceFlowState): RaceFlowState {
  return { ...state, phase: 'FINISHED', countdown: 0, goFlash: 0 };
}

export function raceStartLightCount(state: RaceFlowState): number {
  if (state.phase !== 'COUNTDOWN') return 0;
  const duration = state.startSequenceDuration ?? state.countdown;
  const elapsed = Math.max(0, duration - state.countdown);
  if (elapsed < START_LIGHT_FIRST_SECONDS) return 0;
  return Math.min(
    START_LIGHT_COUNT,
    1 + Math.floor((elapsed - START_LIGHT_FIRST_SECONDS) / START_LIGHT_INTERVAL_SECONDS),
  );
}

export function raceBanner(state: RaceFlowState): string | undefined {
  if (state.phase === 'COUNTDOWN') {
    const lights = raceStartLightCount(state);
    return lights > 0 ? `RED_${lights}` : undefined;
  }
  if (state.phase === 'RACING' && state.goFlash > 0) return 'LIGHTS_OUT';
  return undefined;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
