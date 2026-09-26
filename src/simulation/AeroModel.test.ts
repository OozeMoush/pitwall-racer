import { describe, expect, it } from 'vitest';
import {
  aerodynamicEffect,
  normalizedTowStrength,
  towPowerBoost,
  type AeroCarPose,
} from './AeroModel';
import { TRACK_LENGTH } from './TrackModel';

function car(id: string, metres: number, laneOffset = 0, lap = 1): AeroCarPose {
  return { id, lap, progress: metres / TRACK_LENGTH, laneOffset };
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

  it('still gives a tow from a physically nearby lapped car', () => {
    const subject = car('you', 100, 0, 8);
    const lapped = car('lapped', 126, 0, 7);
    const effect = aerodynamicEffect(subject, [lapped]);
    expect(effect.tow).toBeGreaterThan(0.04);
    expect(effect.dirtyAir).toBeGreaterThan(0.07);
    expect(effect.sourceId).toBe('lapped');
  });

  it('keeps the wake continuous across the start finish line', () => {
    const subject: AeroCarPose = { id: 'you', lap: 3, progress: 0.995, laneOffset: 0 };
    const ahead: AeroCarPose = { id: 'ahead', lap: 4, progress: 0.006, laneOffset: 0 };
    const effect = aerodynamicEffect(subject, [ahead]);
    expect(effect.tow).toBeGreaterThan(0);
  });

  it('normalizes the HUD tow scale to a meaningful 0-100% range', () => {
    const effect = aerodynamicEffect(car('you', 100), [car('ahead', 124)]);
    const normalized = normalizedTowStrength(effect.tow);
    expect(normalized).toBeGreaterThan(0.70);
    expect(normalized).toBeLessThanOrEqual(1);
  });

  it('turns a strong tow into a material chassis power boost', () => {
    const effect = aerodynamicEffect(car('you', 100), [car('ahead', 124)]);
    expect(towPowerBoost(effect.tow)).toBeGreaterThan(0.09);
  });
});
