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
  it('keeps fresh compounds distinct without turning them into different classes of car', () => {
    const soft = oneLap('SOFT');
    const medium = oneLap('MEDIUM');
    const hard = oneLap('HARD');

    expect(soft.lapTime).toBeLessThan(medium.lapTime - 1.2);
    expect(soft.lapTime).toBeGreaterThan(medium.lapTime - 4.0);
    expect(hard.lapTime).toBeGreaterThan(medium.lapTime + 0.35);
    expect(hard.lapTime).toBeLessThan(medium.lapTime + 2.2);
  });

  it('charges Soft much more tyre life while Hard roughly halves the wear rate', () => {
    const soft = oneLap('SOFT');
    const medium = oneLap('MEDIUM');
    const hard = oneLap('HARD');

    expect(soft.wearAtEnd).toBeGreaterThan(medium.wearAtEnd * 2.0);
    expect(hard.wearAtEnd).toBeLessThan(medium.wearAtEnd * 0.55);
  });
});
