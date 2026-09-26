import { describe, expect, it } from 'vitest';
import { aerodynamicEffect, type AeroCarPose } from './AeroModel';
import { TRACK_LENGTH } from './TrackModel';

function car(id: string, metres: number, laneOffset = 0): AeroCarPose {
  return { id, lap: 1, progress: metres / TRACK_LENGTH, laneOffset };
}

describe('racecraft aero feedback', () => {
  it('makes the close wake strong enough to matter on a miniature straight', () => {
    const tucked = aerodynamicEffect(car('you', 100), [car('ahead', 124)]);
    expect(tucked.tow).toBeGreaterThan(0.21);
    expect(tucked.dirtyAir).toBeGreaterThan(0.17);
  });

  it('lets the driver move out of dirty air while keeping useful tow', () => {
    const offset = aerodynamicEffect(car('you', 100, 0), [car('ahead', 128, 14)]);
    expect(offset.dirtyAir).toBe(0);
    expect(offset.tow).toBeGreaterThan(0.055);
  });
});
