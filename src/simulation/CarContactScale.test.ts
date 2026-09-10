import { describe, expect, it } from 'vitest';
import { CAR_COLLIDER_HALF_LENGTH, CAR_COLLIDER_HALF_WIDTH } from './RapierRacePhysics';

describe('dynamic car contact footprint', () => {
  it('does not use the oversized pre-world-scale collision box', () => {
    expect(CAR_COLLIDER_HALF_LENGTH).toBeLessThan(5.2);
    expect(CAR_COLLIDER_HALF_LENGTH).toBeGreaterThan(4.2);
    expect(CAR_COLLIDER_HALF_WIDTH).toBeLessThan(2.5);
    expect(CAR_COLLIDER_HALF_WIDTH).toBeGreaterThan(1.8);
  });
});
