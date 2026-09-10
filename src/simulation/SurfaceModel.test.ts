import { describe, expect, it } from 'vitest';
import { controlArcadeCar } from './ArcadeCarController';
import { surfaceEffect } from './SurfaceModel';

describe('surfaceEffect', () => {
  it('allows one-side kerb use but penalizes a deep four-wheel cut', () => {
    expect(surfaceEffect(29.2)).toEqual({
      severity: 0,
      gripMultiplier: 1,
      powerMultiplier: 1,
      rollingResistance: 0,
      label: 'TRACK',
    });

    const deepKerb = surfaceEffect(30.9);
    expect(deepKerb.label).toBe('RUNOFF');
    expect(deepKerb.severity).toBeGreaterThan(0.25);
    expect(deepKerb.powerMultiplier).toBeLessThan(0.94);
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

  it('makes a deep kerb cut lose speed at race pace', () => {
    const deepKerb = surfaceEffect(30.9);
    const track = surfaceEffect(28);
    const input = {
      throttle: 1,
      brake: 0,
      steer: 0.8,
      tireGrip: 1,
    };
    const clean = controlArcadeCar(
      { vx: 90, vy: 0, heading: 0, angularVelocity: 0 },
      {
        ...input,
        surfaceGrip: track.gripMultiplier,
        powerMultiplier: track.powerMultiplier,
        rollingResistance: track.rollingResistance,
      },
      1 / 60,
    );
    const cut = controlArcadeCar(
      { vx: 90, vy: 0, heading: 0, angularVelocity: 0 },
      {
        ...input,
        surfaceGrip: deepKerb.gripMultiplier,
        powerMultiplier: deepKerb.powerMultiplier,
        rollingResistance: deepKerb.rollingResistance,
      },
      1 / 60,
    );

    expect(cut.acceleration).toBeLessThan(clean.acceleration - 2.5);
  });

  it('makes full grass lose speed at race pace even with full throttle', () => {
    const grass = surfaceEffect(120);
    const result = controlArcadeCar(
      { vx: 90, vy: 0, heading: 0, angularVelocity: 0 },
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

    expect(result.acceleration).toBeLessThan(-3);
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
