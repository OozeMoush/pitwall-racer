import { describe, expect, it } from 'vitest';
import { surfaceEffect } from './SurfaceModel';

describe('surfaceEffect', () => {
  it('keeps normal road pace untouched inside the tighter road', () => {
    expect(surfaceEffect(45)).toEqual({
      severity: 0,
      gripMultiplier: 1,
      powerMultiplier: 1,
      rollingResistance: 0,
      label: 'TRACK',
    });
  });

  it('progressively slows a car that runs beyond the road edge', () => {
    const runoff = surfaceEffect(68);
    const grass = surfaceEffect(108);

    expect(runoff.powerMultiplier).toBeLessThan(1);
    expect(runoff.gripMultiplier).toBeLessThan(1);
    expect(grass.powerMultiplier).toBeLessThan(runoff.powerMultiplier);
    expect(grass.rollingResistance).toBeGreaterThan(runoff.rollingResistance);
    expect(grass.label).toBe('GRASS');
  });
});
