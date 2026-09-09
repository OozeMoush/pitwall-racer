import { describe, expect, it } from 'vitest';
import { aerodynamicEffect, type AeroCarPose } from './AeroModel';
import { TRACK_LENGTH } from './TrackModel';

function car(id: string, metres: number, laneOffset = 0): AeroCarPose {
  return { id, lap: 1, progress: metres / TRACK_LENGTH, laneOffset };
}

describe('aerodynamicEffect', () => {
  it('gives tow and dirty air when tucked in behind', () => {
    const effect = aerodynamicEffect(car('you', 100), [car('ahead', 124)]);
    expect(effect.tow).toBeGreaterThan(0.04);
    expect(effect.dirtyAir).toBeGreaterThan(0.07);
  });

  it('keeps a wider tow wake after moving partly out of dirty air', () => {
    const effect = aerodynamicEffect(car('you', 100, 0), [car('ahead', 130, 14)]);
    expect(effect.tow).toBeGreaterThan(0);
    expect(effect.dirtyAir).toBe(0);
  });

  it('collapses the wake once cars are genuinely side by side', () => {
    const effect = aerodynamicEffect(car('you', 100, -8), [car('ahead', 112, 8)]);
    expect(effect.tow).toBe(0);
    expect(effect.dirtyAir).toBe(0);
  });

  it('does not affect a car outside the wake distance', () => {
    const effect = aerodynamicEffect(car('you', 100), [car('ahead', 190)]);
    expect(effect.tow).toBe(0);
    expect(effect.dirtyAir).toBe(0);
  });
});
