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
    const state = audio as unknown as { context: unknown; master: unknown; driving: unknown };
    const drivingGain = { setTargetAtTime: vi.fn() };
    state.driving = { gain: drivingGain };
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
    // Finish keeps the cue bus under the chosen volume but silences all driving nodes.
    expect(gain.setTargetAtTime).toHaveBeenLastCalledWith(0.21, 0, 0.015);
    expect(drivingGain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.015);
    audio.reset();
    expect(drivingGain.setTargetAtTime).toHaveBeenLastCalledWith(1, 0, 0.015);
    expect(gain.setTargetAtTime).toHaveBeenLastCalledWith(0.21, 0, 0.015);
    audio.dispose();
    expect(close).toHaveBeenCalledOnce();
    gain.setTargetAtTime.mockClear();
    setRaceAudioVolume(1);
    expect(gain.setTargetAtTime).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

// Exercise the actual graph/update path without pretending to verify audible balance.
describe('bounded rival voices and event lifecycle', () => {
  it('creates two persistent rival voices, one-shot cues, hushes driving and consumes paused/muted cues', async () => {
    const events = new EventTarget(); vi.stubGlobal('window', events);
    const oscillators: any[] = []; const panners: any[] = [];
    const param = () => ({ value: 0, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
    const node = () => ({ gain: param(), frequency: param(), Q: param(), pan: param(),
      connect: vi.fn(function (this: unknown) { return this; }), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: undefined as undefined | (() => void) });
    const close = vi.fn().mockResolvedValue(undefined);
    const context = { state: 'running', currentTime: 0, sampleRate: 100,
      destination: node(), close, resume: vi.fn().mockResolvedValue(undefined),
      createGain: () => node(), createBiquadFilter: () => node(),
      createStereoPanner: () => { const n = node(); panners.push(n); return n; },
      createOscillator: () => { const n = node(); oscillators.push(n); return n; },
      createBuffer: () => ({ getChannelData: () => new Float32Array(200) }), createBufferSource: () => node() };
    vi.stubGlobal('AudioContext', class { constructor() { return context; } });
    const { RaceAudio, setRaceAudioVolume } = await import('./RaceAudio');
    setRaceAudioVolume(1);
    const audio = new RaceAudio();
    const rival = { id: 'a', distance: 8, forward: 0, side: 8, speed: 60 };
    try {
      audio.unlock(); expect(oscillators).toHaveLength(4); expect(panners).toHaveLength(2);
      for (let i = 0; i < 200; i++) audio.update({ ...base, rivals: [rival] }, 0.016);
      expect(oscillators).toHaveLength(4);
      expect(panners[0].pan.setTargetAtTime).toHaveBeenLastCalledWith(-1, 0, 0.09);
      audio.update({ ...base, cue: { id: 1, kind: 'BEST' } }, 0.016);
      expect(oscillators).toHaveLength(6);
      audio.update({ ...base, cue: { id: 1, kind: 'BEST' } }, 0.016);
      expect(oscillators).toHaveLength(6);
      const pause = new Event('race-audio-pause'); Object.assign(pause, { detail: true }); events.dispatchEvent(pause);
      expect(oscillators[4].stop).toHaveBeenCalledTimes(2);
      audio.update({ ...base, cue: { id: 2, kind: 'PIT_DONE' } }, 0.016);
      const resume = new Event('race-audio-pause'); Object.assign(resume, { detail: false }); events.dispatchEvent(resume);
      audio.update({ ...base, cue: { id: 2, kind: 'PIT_DONE' } }, 0.016);
      expect(oscillators).toHaveLength(6);
      setRaceAudioVolume(0);
      audio.update({ ...base, cue: { id: 3, kind: 'BEST' } }, 0.016);
      setRaceAudioVolume(1); audio.update({ ...base, cue: { id: 3, kind: 'BEST' } }, 0.016);
      expect(oscillators).toHaveLength(6);
      context.state = 'suspended';
      audio.update({ ...base, cue: { id: 99, kind: 'BEST' } }, 0.016);
      context.state = 'running';
      audio.update({ ...base, cue: { id: 99, kind: 'BEST' } }, 0.016);
      expect(oscillators).toHaveLength(6);
      audio.update({ ...base, inactive: true, cue: { id: 4, kind: 'FINISH' } }, 0.016);
      expect(oscillators).toHaveLength(9); // 4 persistent + 2 consumed + 3 finish notes
      audio.update({ ...base, inactive: true, cue: { id: 4, kind: 'FINISH' } }, 0.016);
      expect(oscillators).toHaveLength(9);
      const internals = audio as any;
      expect(internals.driving.gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 0, 0.015);
      for (const n of oscillators.slice(6)) n.onended?.();
      expect(internals.transients.size).toBe(0);
      audio.reset(); expect(internals.transients.size).toBe(0);
      const beforeSpam = oscillators.length;
      for (let i = 0; i < 20; i++) audio.update({ ...base, cue: { id: 100 + i, kind: 'BEST' } }, 0.016);
      expect(internals.transients.size).toBe(8);
      expect(oscillators.length - beforeSpam).toBe(8);
      setRaceAudioVolume(0); expect(internals.transients.size).toBe(0);
      setRaceAudioVolume(1);
    } finally { audio.dispose(); expect(close).toHaveBeenCalledOnce(); vi.unstubAllGlobals(); }
  });
});
