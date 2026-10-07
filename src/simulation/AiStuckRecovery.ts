export type AiRecoveryPhase = 'NORMAL' | 'REVERSE' | 'RECOVER';

export interface AiStuckRecoveryState {
  phase: AiRecoveryPhase;
  stalledSeconds: number;
  phaseSeconds: number;
}

export interface AiStuckRecoveryInput {
  speed: number;
  targetSpeed: number;
  /** Explicit transit intent allows recovery on deliberately slow pit bends. */
  movementRequested?: boolean;
}

export const AI_STUCK_SPEED_THRESHOLD = 2.2;
export const AI_STUCK_TARGET_SPEED_THRESHOLD = 20;
export const AI_STUCK_TRIGGER_SECONDS = 1.25;
export const AI_REVERSE_SECONDS = 0.85;
export const AI_RECOVER_MAX_SECONDS = 1.4;
export const AI_RECOVER_EXIT_SPEED = 10;

export function createAiStuckRecoveryState(): AiStuckRecoveryState {
  return {
    phase: 'NORMAL',
    stalledSeconds: 0,
    phaseSeconds: 0,
  };
}

export function stepAiStuckRecovery(
  state: AiStuckRecoveryState,
  input: AiStuckRecoveryInput,
  dt: number,
): AiStuckRecoveryState {
  const step = Math.max(0, dt);

  if (state.phase === 'NORMAL') {
    const genuinelyStalled =
      input.speed < AI_STUCK_SPEED_THRESHOLD
      && (input.movementRequested ?? input.targetSpeed > AI_STUCK_TARGET_SPEED_THRESHOLD);

    const stalledSeconds = genuinelyStalled
      ? state.stalledSeconds + step
      : 0;

    if (stalledSeconds >= AI_STUCK_TRIGGER_SECONDS) {
      return {
        phase: 'REVERSE',
        stalledSeconds: 0,
        phaseSeconds: 0,
      };
    }

    return {
      phase: 'NORMAL',
      stalledSeconds,
      phaseSeconds: 0,
    };
  }

  if (state.phase === 'REVERSE') {
    const phaseSeconds = state.phaseSeconds + step;
    if (phaseSeconds >= AI_REVERSE_SECONDS) {
      return {
        phase: 'RECOVER',
        stalledSeconds: 0,
        phaseSeconds: 0,
      };
    }

    return {
      phase: 'REVERSE',
      stalledSeconds: 0,
      phaseSeconds,
    };
  }

  if (
    input.speed >= AI_RECOVER_EXIT_SPEED
    || state.phaseSeconds + step >= AI_RECOVER_MAX_SECONDS
  ) {
    return createAiStuckRecoveryState();
  }

  return {
    phase: 'RECOVER',
    stalledSeconds: 0,
    phaseSeconds: state.phaseSeconds + step,
  };
}
