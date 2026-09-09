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

  it('keeps ordinary steering quiet and squeals only near the tyre limit', () => {
    const ordinaryTurn = raceAudioParameters({ ...base, speed: 72, steer: 0.55, tireGrip: 1.02 });
    const stressed = raceAudioParameters({ ...base, speed: 90, steer: 1, brake: 0.5, tireGrip: 0.78 });
    expect(ordinaryTurn.tireGain).toBeLessThan(0.012);
    expect(stressed.tireGain).toBeGreaterThan(ordinaryTurn.tireGain + 0.04);
  });

  it('adds surface noise off track', () => {
    const track = raceAudioParameters({ ...base, speed: 70, surfaceSeverity: 0 });
    const grass = raceAudioParameters({ ...base, speed: 70, surfaceSeverity: 1 });
    expect(grass.surfaceGain).toBeGreaterThan(track.surfaceGain);
  });
});
