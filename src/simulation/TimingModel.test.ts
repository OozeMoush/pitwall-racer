import { describe, expect, it } from 'vitest';
import { completeLap, createTiming, formatLapTime, stepTiming } from './TimingModel';

describe('TimingModel', () => {
  it('records last and best lap times', () => {
    let timing = createTiming();
    timing = stepTiming(timing, 90.5);
    timing = completeLap(timing);
    expect(timing.lastLapTime).toBeCloseTo(90.5);
    expect(timing.bestLapTime).toBeCloseTo(90.5);

    timing = stepTiming(timing, 89.2);
    timing = completeLap(timing);
    expect(timing.bestLapTime).toBeCloseTo(89.2);
    expect(timing.deltaToBest).toBeCloseTo(-1.3);
  });

  it('formats formula-style lap times', () => {
    expect(formatLapTime(91.234)).toBe('1:31.234');
    expect(formatLapTime()).toBe('--:--.---');
  });
});
