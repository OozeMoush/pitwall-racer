import { describe, expect, it } from 'vitest';
import { canRecover } from './RecoveryModel';

describe('canRecover', () => {
  it('allows recovery only when badly off track and nearly stopped', () => {
    expect(canRecover(130, 8)).toBe(true);
    expect(canRecover(90, 8)).toBe(false);
    expect(canRecover(130, 35)).toBe(false);
  });
});
