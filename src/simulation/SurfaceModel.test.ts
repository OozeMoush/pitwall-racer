import { describe, expect, it } from 'vitest';
import { controlArcadeCar } from './ArcadeCarController';
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
    const grass = surfaceEffect(70);

    expect(runoff.powerMultiplier).toBeLessThan(1);
    expect(runoff.gripMultiplier).toBeLessThan(1);
    expect(grass.powerMultiplier).toBeLessThan(runoff.powerMultiplier);
    expect(grass.rollingResistance).toBeGreaterThan(runoff.rollingResistance);
    expect(grass.label).toBe('GRASS');
  });

  it('still lets a slowed car accelerate through full grass and drive back', () => {
    const grass = surfaceEffect(120);
    const result = controlArcadeCar(
      { vx: 5, vy: 0, heading: 0, angularVelocity: 0 },
      {
        throttle: 1,
        brake: 0,
        steer: 0,
        tireGrip: 1,
        surfaceGrip: grass.gripMultiplier,
        powerMultiplier: grass.powerMultiplier,
        rollingResistance: grass.rollingResistance,
      },
      1 / 60,
    );

    expect(result.acceleration).toBeGreaterThan(0);
  });
});
