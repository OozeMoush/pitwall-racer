import { describe, expect, it } from 'vitest';
import {
  AI_RECOVER_EXIT_SPEED,
  AI_REVERSE_SECONDS,
  AI_STUCK_TRIGGER_SECONDS,
  createAiStuckRecoveryState,
  stepAiStuckRecovery,
} from './AiStuckRecovery';

describe('AiStuckRecovery', () => {
  it('does not treat an ordinary slow corner as a stuck car', () => {
    let state = createAiStuckRecoveryState();
    for (let elapsed = 0; elapsed < 3; elapsed += 0.1) {
      state = stepAiStuckRecovery(state, {
        speed: 8,
        targetSpeed: 14,
      }, 0.1);
    }
    expect(state.phase).toBe('NORMAL');
    expect(state.stalledSeconds).toBe(0);
  });

  it('enters reverse only after a sustained near-stop against a much faster target', () => {
    let state = createAiStuckRecoveryState();
    for (let elapsed = 0; elapsed < AI_STUCK_TRIGGER_SECONDS - 0.1; elapsed += 0.1) {
      state = stepAiStuckRecovery(state, {
        speed: 0.8,
        targetSpeed: 58,
      }, 0.1);
    }
    expect(state.phase).toBe('NORMAL');

    state = stepAiStuckRecovery(state, {
      speed: 0.8,
      targetSpeed: 58,
    }, 0.2);
    expect(state.phase).toBe('REVERSE');
  });

  it('backs for a short fixed window then returns through a forward recovery phase', () => {
    let state = {
      ...createAiStuckRecoveryState(),
      phase: 'REVERSE' as const,
    };

    state = stepAiStuckRecovery(state, { speed: 4, targetSpeed: 58 }, AI_REVERSE_SECONDS + 0.01);
    expect(state.phase).toBe('RECOVER');

    state = stepAiStuckRecovery(state, {
      speed: AI_RECOVER_EXIT_SPEED + 1,
      targetSpeed: 58,
    }, 0.1);
    expect(state.phase).toBe('NORMAL');
  });

  it('cancels an accumulating stuck timer as soon as the car gets moving', () => {
    let state = createAiStuckRecoveryState();
    state = stepAiStuckRecovery(state, { speed: 1, targetSpeed: 60 }, 0.8);
    expect(state.stalledSeconds).toBeGreaterThan(0);

    state = stepAiStuckRecovery(state, { speed: 12, targetSpeed: 60 }, 0.1);
    expect(state.phase).toBe('NORMAL');
    expect(state.stalledSeconds).toBe(0);
  });
});
