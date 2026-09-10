import { describe, expect, it } from 'vitest';
import { raceAudioParameters } from './RaceAudio';

const base = {
  speed: 0,
  throttle: 0,
  brake: 0,
  steer: 0,
  tireGrip: 1,
  surfaceSeverity: 0,
  trafficPressure: 0,
  pitService: false,
};

describe('raceAudioParameters', () => {
  it('raises engine pitch and gain with speed/load', () => {
    const idle = raceAudioParameters(base);
    const fast = raceAudioParameters({ ...base, speed: 100, throttle: 1 });
    expect(fast.engineFrequency).toBeGreaterThan(idle.engineFrequency + 200);
    expect(fast.engineGain).toBeGreaterThan(idle.engineGain);
  });

  it('keeps ordinary steering quiet', () => {
    const ordinaryTurn = raceAudioParameters({ ...base, speed: 72, steer: 0.55, tireGrip: 0.88 });
    expect(ordinaryTurn.tireGain).toBeLessThan(0.012);
  });

  it('makes an actual rear-slide event audibly obvious without relying on worn-grip hiss', () => {
    const ordinaryTurn = raceAudioParameters({ ...base, speed: 88, steer: 0.8, tireGrip: 0.88 });
    const slide = raceAudioParameters({ ...base, speed: 88, steer: 0.8, tireGrip: 0.88, slideSeverity: 0.95 });
    expect(slide.tireGain).toBeGreaterThan(ordinaryTurn.tireGain + 0.045);
  });

  it('still squeals under heavy braking near the tyre limit', () => {
    const ordinary = raceAudioParameters({ ...base, speed: 80, steer: 0.3 });
    const stressed = raceAudioParameters({ ...base, speed: 95, steer: 0.8, brake: 0.7 });
    expect(stressed.tireGain).toBeGreaterThan(ordinary.tireGain + 0.04);
  });

  it('adds surface noise off track', () => {
    const track = raceAudioParameters({ ...base, speed: 70, surfaceSeverity: 0 });
    const grass = raceAudioParameters({ ...base, speed: 70, surfaceSeverity: 1 });
    expect(grass.surfaceGain).toBeGreaterThan(track.surfaceGain);
  });
});
