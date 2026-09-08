import { describe, expect, it } from 'vitest';
import { simulateStrategy, type StrategyPlan } from './StrategySimulator';

function oneLap(compound: 'SOFT' | 'MEDIUM' | 'HARD') {
  const plan: StrategyPlan = {
    name: compound,
    startCompound: compound,
    paceForLap: () => 'BALANCED',
  };
  return simulateStrategy(plan, 1).laps[0];
}

describe('compound contrast', () => {
  it('makes fresh Soft dramatically faster and Hard dramatically slower than Medium', () => {
    const soft = oneLap('SOFT');
    const medium = oneLap('MEDIUM');
    const hard = oneLap('HARD');

    expect(soft.lapTime).toBeLessThan(medium.lapTime - 7);
    expect(hard.lapTime).toBeGreaterThan(medium.lapTime + 7);
  });

  it('charges Soft much more tyre life for that opening pace', () => {
    const soft = oneLap('SOFT');
    const medium = oneLap('MEDIUM');
    const hard = oneLap('HARD');

    expect(soft.wearAtEnd).toBeGreaterThan(medium.wearAtEnd * 2.1);
    expect(hard.wearAtEnd).toBeLessThan(medium.wearAtEnd * 0.55);
  });
});
