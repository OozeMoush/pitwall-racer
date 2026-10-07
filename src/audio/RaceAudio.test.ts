import { describe, expect, it, vi } from 'vitest';
import { ContactAudioGate, raceAudioParameters } from './RaceAudio';

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


describe('contact audio gate', () => {
  it('does not invent a collision from braking or nearby traffic', () => {
    const gate = new ContactAudioGate();
    expect(gate.update('NONE', 30)).toBe(0);
    expect(gate.update('NONE', 0)).toBe(0);
  });
  it('sounds a real impact once until separation, including barriers', () => {
    const gate = new ContactAudioGate();
    expect(gate.update('CAR', 11)).toBe(0.5);
    expect(gate.update('CAR', 30)).toBe(0);
    gate.update('NONE');
    expect(gate.update('BARRIER', 44)).toBe(1);
  });
  it('suppresses gentle rubbing and rearms after restart', () => {
    const gate = new ContactAudioGate();
    expect(gate.update('CAR', 1)).toBe(0);
    gate.reset();
    expect(gate.update('CAR', 11)).toBe(0.5);
  });
});

describe('audio lifecycle', () => {
  it('hushes on pause and finish, restores chosen volume, and removes session listeners', async () => {
    const events = new EventTarget();
    vi.stubGlobal('window', events);
    const { RaceAudio, setRaceAudioVolume } = await import('./RaceAudio');
    const audio = new RaceAudio();
    const gain = { setTargetAtTime: vi.fn() };
    const close = vi.fn().mockResolvedValue(undefined);
    const state = audio as unknown as { context: unknown; master: unknown };
    state.context = { state: 'running', currentTime: 0, close };
    state.master = { gain };
    setRaceAudioVolume(0.5);
    expect(gain.setTargetAtTime).toHaveBeenLastCalledWith(0.21, 0, 0.015);
    const pause = new Event('race-audio-pause');
    Object.assign(pause, { detail: true });
    events.dispatchEvent(pause);
    expect(gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.015);
    const resume = new Event('race-audio-pause');
    Object.assign(resume, { detail: false });
    events.dispatchEvent(resume);
    expect(gain.setTargetAtTime).toHaveBeenLastCalledWith(0.21, 0, 0.015);
    audio.update({ ...base, inactive: true }, 0.016);
    expect(gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.015);
    audio.reset();
    expect(gain.setTargetAtTime).toHaveBeenLastCalledWith(0.21, 0, 0.015);
    audio.dispose();
    expect(close).toHaveBeenCalledOnce();
    gain.setTargetAtTime.mockClear();
    setRaceAudioVolume(1);
    expect(gain.setTargetAtTime).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
