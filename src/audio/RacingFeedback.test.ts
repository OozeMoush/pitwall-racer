import { describe, expect, it } from 'vitest';
import { nearestRivalSounds, rivalAudioParameters } from './RivalAudioModel';
import { RaceFeedbackTracker } from './RaceFeedbackModel';
const state = { phase: 'RACING', lap: 1, position: 8, pitPhase: 'IDLE' };
describe('physical rival audio', () => {
  it('selects only the closest two physical cars within range, including a lapped rival', () => {
    const rivals = nearestRivalSounds({ x: 0, y: 0, heading: 0 }, [
      { id: 'far', x: 50, y: 0, speed: 80 }, { id: 'left', x: 0, y: 8, speed: 50 },
      { id: 'right', x: 0, y: -10, speed: 60 }, { id: 'third', x: 20, y: 0, speed: 80 },
      { id: 'bad', x: NaN, y: 0, speed: 80 },
    ]);
    expect(rivals.map(r => r.id)).toEqual(['left', 'right']);
    expect(rivalAudioParameters(rivals[0]).pan).toBeLessThan(0);
    expect(rivalAudioParameters(rivals[1]).pan).toBeGreaterThan(0);
  });
  it('rotates direction with the driver and attenuates smoothly to silence', () => {
    const r = nearestRivalSounds({ x: 10, y: 20, heading: Math.PI / 2 }, [{ id: 'a', x: 2, y: 20, speed: 70 }])[0];
    expect(r.side).toBeCloseTo(8); expect(r.forward).toBeCloseTo(0);
    const near = rivalAudioParameters(r); const far = rivalAudioParameters({ ...r, distance: 44 });
    expect(near.gain).toBeGreaterThan(far.gain); expect(near.gain).toBeLessThanOrEqual(0.027);
    expect(rivalAudioParameters({ ...r, distance: 45 }).gain).toBe(0);
    expect(rivalAudioParameters().gain).toBe(0);
    expect(rivalAudioParameters({ ...r, distance: NaN }).gain).toBe(0);
    expect(rivalAudioParameters({ ...r, forward: -10 }).cutoff).toBeLessThan(rivalAudioParameters({ ...r, forward: 10 }).cutoff);
  });
});
describe('race event feedback', () => {
  it('ignores initial grid state, brief rank jitter and pre-start changes', () => {
    const t = new RaceFeedbackTracker();
    expect(t.update({ ...state, phase: 'COUNTDOWN', lap: 0 }, 0)).toBeUndefined();
    expect(t.update({ ...state, phase: 'COUNTDOWN', lap: 0, position: 7 }, 1)).toBeUndefined();
    t.update(state, 2); t.update({ ...state, position: 7 }, 2.1);
    expect(t.update(state, 2.5)).toBeUndefined();
    t.update({ ...state, position: 7 }, 3);
    expect(t.update({ ...state, position: 7 }, 3.8)).toBe('POSITION_UP');
    expect(t.update({ ...state, position: 7 }, 4)).toBeUndefined();
  });
  it('sounds pit completion only after actual service and physical exit, never a request', () => {
    const t = new RaceFeedbackTracker(); t.update(state, 0);
    expect(t.update({ ...state, pitPhase: 'TRANSIT_OUT' }, 1)).toBeUndefined();
    expect(t.update(state, 2)).toBeUndefined();
    t.update({ ...state, pitPhase: 'SERVICE' }, 3); t.update({ ...state, pitPhase: 'TRANSIT_OUT' }, 4);
    expect(t.update(state, 5)).toBe('PIT_DONE'); expect(t.update(state, 5.1)).toBeUndefined();
  });
  it('reports real best improvement, suppresses duplicates and spaced cues, prioritizes finish', () => {
    const t = new RaceFeedbackTracker(); t.update(state, 0);
    expect(t.update({ ...state, best: 30 }, 1)).toBe('BEST');
    expect(t.update({ ...state, best: 30 }, 1.1)).toBeUndefined();
    expect(t.update({ ...state, best: 29 }, 1.2)).toBeUndefined();
    expect(t.update({ ...state, best: 29 }, 4)).toBeUndefined();
    expect(t.update({ ...state, best: 28 }, 5)).toBe('BEST');
    expect(t.update({ ...state, phase: 'FINISHED', best: 28 }, 5.1)).toBe('FINISH');
    expect(t.update({ ...state, phase: 'FINISHED', best: 28 }, 6)).toBeUndefined();
    t.reset(); expect(t.update(state, 0)).toBeUndefined();
  });
});
