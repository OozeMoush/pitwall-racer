import { describe, expect, it } from 'vitest';
import { selectStartingTyre } from './StrategySelection';

describe('selectStartingTyre', () => {
  it('suggests a different next compound by default', () => {
    expect(selectStartingTyre('SOFT')).toEqual({ startCompound: 'SOFT', suggestedNextCompound: 'MEDIUM' });
    expect(selectStartingTyre('MEDIUM')).toEqual({ startCompound: 'MEDIUM', suggestedNextCompound: 'SOFT' });
    expect(selectStartingTyre('HARD')).toEqual({ startCompound: 'HARD', suggestedNextCompound: 'MEDIUM' });
  });
});
