import { describe, expect, it } from 'vitest';
import { minimumPositive, timingTone } from './TimingToneModel';

describe('timingTone', () => {
  it('uses purple for the session fastest lap before green personal-best status', () => {
    expect(timingTone(61.2, 61.2, 61.2)).toBe('session-best');
  });

  it('uses green when the lap is a personal best but another driver is faster', () => {
    expect(timingTone(61.8, 61.8, 61.2)).toBe('personal-best');
  });

  it('keeps ordinary timing neutral', () => {
    expect(timingTone(63.1, 61.8, 61.2)).toBe('neutral');
  });

  it('finds the best valid timing sample', () => {
    expect(minimumPositive([undefined, 0, 62.4, 61.9, 63])).toBe(61.9);
  });
});
