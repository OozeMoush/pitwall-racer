import { describe, expect, it } from 'vitest';
import { surfaceEffect } from './SurfaceModel';

describe('surfaceEffect', () => {
  it('keeps the visible road untouched but penalizes the runoff quickly', () => {
    expect(surfaceEffect(26)).toEqual({
      severity: 0,
      gripMultiplier: 1,
      powerMultiplier: 1,
      rollingResistance: 0,
      label: 'TRACK',
    });
    expect(surfaceEffect(34).label).toBe('RUNOFF');
  });

  it('progressively slows a car that runs beyond the road edge', () => {
    const runoff = surfaceEffect(36);
    const grass = surfaceEffect(50);

    expect(runoff.powerMultiplier).toBeLessThan(1);
    expect(runoff.gripMultiplier).toBeLessThan(1);
    expect(grass.powerMultiplier).toBeLessThan(runoff.powerMultiplier);
    expect(grass.rollingResistance).toBeGreaterThan(runoff.rollingResistance);
    expect(grass.label).toBe('GRASS');
  });
});
