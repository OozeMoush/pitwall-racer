import { describe, expect, it } from 'vitest';
import { evaluateLaunch, stepLaunchCharge } from './RaceStartModel';

describe('RaceStartModel', () => {
  it('rewards pressing W near the final second rather than holding from the first light', () => {
    let timed = 0;
    for (let i = 0; i < 120; i++) timed = stepLaunchCharge(timed, true, 1 / 120);
    expect(evaluateLaunch(timed).quality).toBe('PERFECT');

    let held = 0;
    for (let i = 0; i < 360; i++) held = stepLaunchCharge(held, true, 1 / 120);
    expect(evaluateLaunch(held).quality).toBe('WHEELSPIN');
  });

  it('makes a perfect launch materially better than a bogged start', () => {
    const perfect = evaluateLaunch(0.68);
    const bogged = evaluateLaunch(0.12);
    expect(perfect.powerBoost).toBeGreaterThan(bogged.powerBoost + 0.15);
  });
});
