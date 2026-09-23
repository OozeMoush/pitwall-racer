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

function countFragmentedCornerSlides(wear: number, laps = 1): number {
  let state = createTyreSlideState(0.37);
  let count = 0;
  const dt = 1 / 120;

  for (let lap = 0; lap < laps; lap++) {
    for (let corner = 0; corner < 8; corner++) {
      for (let elapsed = 0; elapsed < 1.5; elapsed += dt) {
        const step = stepTyreSlide(state, { wear, speed: 92, steer: 0.95, throttle: 1 }, dt);
        state = step.state;
        if (step.triggered) count += 1;
      }
      for (let elapsed = 0; elapsed < 4; elapsed += dt) {
        const step = stepTyreSlide(state, { wear, speed: 108, steer: 0, throttle: 1 }, dt);
        state = step.state;
        if (step.triggered) count += 1;
      }
    }
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

  it('keeps corner stress between bends so a used Medium-like tyre actually slides in a lap', () => {
    const fresh = countFragmentedCornerSlides(0.05, 2);
    const used = countFragmentedCornerSlides(0.50, 1);
    const worn = countFragmentedCornerSlides(0.80, 1);

    expect(fresh).toBe(0);
    expect(used).toBeGreaterThanOrEqual(1);
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
  it('makes a high-wear slide materially longer and stronger than a mid-stint slide', () => {
    const trigger = (wear: number) => {
      let state = createTyreSlideState(0.37);
      for (let tick = 0; tick < 12000; tick++) {
        const step = stepTyreSlide(state, {
          wear,
          speed: 92,
          steer: 0.92,
          throttle: 0.85,
        }, 1 / 120);
        state = step.state;
        if (step.triggered) return step;
      }
      throw new Error('slide did not trigger');
    };

    const mid = trigger(0.45);
    const worn = trigger(0.90);
    expect(worn.state.intensity).toBeGreaterThan(mid.state.intensity + 0.35);
    expect(worn.state.remaining).toBeGreaterThan(mid.state.remaining + 0.30);
    expect(worn.state.intensity).toBeGreaterThan(1.15);
  });

});
