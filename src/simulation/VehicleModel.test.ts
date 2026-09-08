import { describe, expect, it } from 'vitest';
import { createTire } from './TireModel';
import { createVehicle, stepVehicle } from './VehicleModel';

describe('VehicleModel tyre feel', () => {
  it('turns less eagerly on heavily worn tyres', () => {
    const vehicle = { ...createVehicle(0, 0, 0), speed: 70 };
    const fresh = createTire('MEDIUM');
    const worn = { ...fresh, wear: 0.9, grip: fresh.grip };
    const controls = { throttle: 0, brake: 0, steer: 1 };

    const freshNext = stepVehicle(vehicle, controls, fresh, 0.1);
    const wornNext = stepVehicle(vehicle, controls, worn, 0.1);
    expect(Math.abs(wornNext.yawRate)).toBeLessThan(Math.abs(freshNext.yawRate));
  });

  it('needs more braking distance on heavily worn tyres', () => {
    const vehicle = { ...createVehicle(0, 0, 0), speed: 80 };
    const fresh = createTire('MEDIUM');
    const worn = { ...fresh, wear: 0.9, grip: fresh.grip };
    const controls = { throttle: 0, brake: 1, steer: 0 };

    const freshNext = stepVehicle(vehicle, controls, fresh, 0.1);
    const wornNext = stepVehicle(vehicle, controls, worn, 0.1);
    expect(wornNext.speed).toBeGreaterThan(freshNext.speed);
  });

  it('loses acceleration and steering confidence off track', () => {
    const vehicle = { ...createVehicle(0, 0, 0), speed: 45 };
    const tire = createTire('MEDIUM');
    const controls = { throttle: 1, brake: 0, steer: 1 };

    const track = stepVehicle(vehicle, controls, tire, 0.2);
    const grass = stepVehicle(vehicle, controls, tire, 0.2, {
      surfaceGrip: 0.62,
      powerMultiplier: 0.48,
      rollingResistance: 8,
    });

    expect(grass.speed).toBeLessThan(track.speed);
    expect(Math.abs(grass.yawRate)).toBeLessThan(Math.abs(track.yawRate));
  });

  it('has much less steering authority at very high speed', () => {
    const tire = createTire('MEDIUM');
    const controls = { throttle: 1, brake: 0, steer: 1 };
    const mediumSpeed = { ...createVehicle(0, 0, 0), speed: 55 };
    const highSpeed = { ...createVehicle(0, 0, 0), speed: 100 };

    const mediumNext = stepVehicle(mediumSpeed, controls, tire, 0.1);
    const highNext = stepVehicle(highSpeed, controls, tire, 0.1);

    expect(Math.abs(highNext.yawRate)).toBeLessThan(Math.abs(mediumNext.yawRate) * 0.52);
  });

  it('makes braking at high speed produce a large immediate speed change', () => {
    const tire = createTire('MEDIUM');
    const vehicle = { ...createVehicle(0, 0, 0), speed: 105 };
    const next = stepVehicle(vehicle, { throttle: 0, brake: 1, steer: 0 }, tire, 0.2);

    expect(vehicle.speed - next.speed).toBeGreaterThan(24);
  });

  it('creates clearly separated HARVEST NORMAL and DEPLOY speed envelopes', () => {
    const tire = createTire('MEDIUM');
    const controls = { throttle: 1, brake: 0, steer: 0 };
    const fast = { ...createVehicle(0, 0, 0), speed: 108 };

    const harvest = stepVehicle(fast, controls, tire, 0.2, { powerBoost: -0.16 });
    const normal = stepVehicle(fast, controls, tire, 0.2, { powerBoost: 0.065 });
    const deploy = stepVehicle(fast, controls, tire, 0.2, { powerBoost: 0.31 });

    expect(harvest.speed).toBeLessThan(normal.speed - 10);
    expect(deploy.speed).toBeGreaterThan(normal.speed + 5);
  });
});
