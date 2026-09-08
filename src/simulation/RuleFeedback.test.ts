import { describe, expect, it } from 'vitest';
import { twoCompoundWarning } from './RuleFeedback';
import type { Compound } from './TireModel';

describe('twoCompoundWarning', () => {
  const one = new Set<Compound>(['MEDIUM']);
  const legal = new Set<Compound>(['MEDIUM', 'SOFT']);

  it('stays quiet until the race is late enough to matter', () => {
    expect(twoCompoundWarning(one, 'MEDIUM', 'SOFT', 4, 8, false)).toBeUndefined();
  });

  it('warns when the selected next tyre would not satisfy the rule', () => {
    expect(twoCompoundWarning(one, 'MEDIUM', 'MEDIUM', 6, 8, false)).toContain('DIFFERENT TYRE');
  });

  it('becomes explicit on the final lap and disappears once legal', () => {
    expect(twoCompoundWarning(one, 'MEDIUM', 'SOFT', 8, 8, false)).toContain('BOX NOW');
    expect(twoCompoundWarning(legal, 'SOFT', 'MEDIUM', 8, 8, false)).toBeUndefined();
  });
});
