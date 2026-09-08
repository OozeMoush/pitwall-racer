import { describe, expect, it } from 'vitest';
import { createRaceFlow, finishRaceFlow, raceBanner, stepRaceFlow } from './RaceFlow';

describe('RaceFlow', () => {
  it('counts down from three before racing and briefly shows GO', () => {
    let flow = createRaceFlow();
    expect(flow.phase).toBe('COUNTDOWN');
    expect(raceBanner(flow)).toBe('3');

    flow = stepRaceFlow(flow, 3);
    expect(flow.phase).toBe('RACING');
    expect(raceBanner(flow)).toBe('GO');

    flow = stepRaceFlow(flow, 0.8);
    expect(raceBanner(flow)).toBeUndefined();
  });

  it('freezes into FINISHED until the scene is restarted', () => {
    const flow = finishRaceFlow(stepRaceFlow(createRaceFlow(), 3));
    expect(flow.phase).toBe('FINISHED');
    expect(stepRaceFlow(flow, 10)).toEqual(flow);
  });
});
