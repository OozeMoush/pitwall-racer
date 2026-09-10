import { describe, expect, it } from 'vitest';
import { createTyreSlideState, stepTyreSlide, tyreSlideRisk } from './TyrePerformanceModel';

function countSlides(wear: number, seconds = 10): number {
  let state = createTyreSlideState(0.37);
  let count = 0;
  const dt = 1 / 120;
  for (let elapsed = 0; elapsed < seconds; elapsed += dt) {
    const step = stepTyreSlide(state, { wear, speed: 92, steer: 0.95, throttle: 1 }, dt);
    state = step.state;
    if (step.triggered) count += 1;
  }
  return count;
}

describe('wear-driven tyre slide events', () => {
  it('keeps fresh tyres stable while increasing event risk with wear', () => {
    expect(tyreSlideRisk(0.05)).toBe(0);
    expect(tyreSlideRisk(0.55)).toBeGreaterThan(tyreSlideRisk(0.35));
    expect(tyreSlideRisk(0.85)).toBeGreaterThan(tyreSlideRisk(0.55));
  });

  it('makes worn tyres lose the rear more often instead of applying permanent slip', () => {
    const fresh = countSlides(0.05);
    const used = countSlides(0.55);
    const worn = countSlides(0.85);

    expect(fresh).toBe(0);
    expect(used).toBeGreaterThan(fresh);
    expect(worn).toBeGreaterThan(used);
  });

  it('produces a short obvious event that ends after the driver catches it', () => {
    let state = createTyreSlideState(0.12);
    let peak = 0;
    let triggered = false;
    const dt = 1 / 120;

    for (let elapsed = 0; elapsed < 4; elapsed += dt) {
      const step = stepTyreSlide(state, { wear: 0.9, speed: 95, steer: 1, throttle: 1 }, dt);
      state = step.state;
      peak = Math.max(peak, step.severity);
      triggered ||= step.triggered;
      if (triggered && step.severity === 0) break;
    }

    expect(triggered).toBe(true);
    expect(peak).toBeGreaterThan(0.9);

    for (let elapsed = 0; elapsed < 1; elapsed += dt) {
      const step = stepTyreSlide(state, { wear: 0.9, speed: 80, steer: 0, throttle: 0.5 }, dt);
      state = step.state;
      expect(step.severity).toBe(0);
    }
  });
});
