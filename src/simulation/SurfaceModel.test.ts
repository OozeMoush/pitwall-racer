import { describe, expect, it } from 'vitest';
import { surfaceEffect } from './SurfaceModel';

describe('surfaceEffect', () => {
  it('keeps normal road pace untouched', () => {
    expect(surfaceEffect(55)).toEqual({
      severity: 0,
      gripMultiplier: 1,
      powerMultiplier: 1,
      rollingResistance: 0,
      label: 'TRACK',
    });
  });

  it('progressively slows a car that cuts farther off track', () => {
    const runoff = surfaceEffect(85);
    const grass = surfaceEffect(125);

    expect(runoff.powerMultiplier).toBeLessThan(1);
    expect(runoff.gripMultiplier).toBeLessThan(1);
    expect(grass.powerMultiplier).toBeLessThan(runoff.powerMultiplier);
    expect(grass.rollingResistance).toBeGreaterThan(runoff.rollingResistance);
    expect(grass.label).toBe('GRASS');
  });
});
