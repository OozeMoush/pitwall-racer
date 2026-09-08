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
  it('makes fresh Soft obviously faster and fresh Hard obviously slower than Medium', () => {
    const soft = oneLap('SOFT');
    const medium = oneLap('MEDIUM');
    const hard = oneLap('HARD');

    expect(soft.lapTime).toBeLessThan(medium.lapTime - 4);
    expect(hard.lapTime).toBeGreaterThan(medium.lapTime + 4);
  });

  it('charges Soft much more tyre life for that opening pace', () => {
    const soft = oneLap('SOFT');
    const medium = oneLap('MEDIUM');
    const hard = oneLap('HARD');

    expect(soft.wearAtEnd).toBeGreaterThan(medium.wearAtEnd * 1.8);
    expect(hard.wearAtEnd).toBeLessThan(medium.wearAtEnd * 0.65);
  });
});
