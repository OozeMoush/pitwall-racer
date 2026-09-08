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
});
