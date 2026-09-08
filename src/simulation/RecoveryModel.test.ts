import { describe, expect, it } from 'vitest';
import { canRecover } from './RecoveryModel';

describe('canRecover', () => {
  it('allows recovery when clearly stranded without requiring an almost complete stop', () => {
    expect(canRecover(90, 24)).toBe(true);
    expect(canRecover(60, 24)).toBe(false);
    expect(canRecover(90, 40)).toBe(false);
  });
});
