import { describe, expect, it } from 'vitest';
import { resolvePlayerTraffic } from './BattleModel';
import { createVehicle } from './VehicleModel';

describe('BattleModel', () => {
  it('reports pressure before contact', () => {
    const player = { ...createVehicle(100, 100, 0), speed: 60 };
    const result = resolvePlayerTraffic(player, [{ x: 150, y: 100, heading: 0, speed: 58 }]);
    expect(result.pressure).toBeGreaterThan(0);
    expect(result.contact).toBe(0);
  });

  it('caps closing speed on nose-to-tail overlap without a large teleport', () => {
    const player = { ...createVehicle(100, 100, 0), speed: 70 };
    const result = resolvePlayerTraffic(player, [{ x: 130, y: 100, heading: 0, speed: 55 }]);
    expect(result.contact).toBeGreaterThan(0);
    expect(result.vehicle.x).toBeLessThan(100);
    expect(100 - result.vehicle.x).toBeLessThan(2);
    expect(result.vehicle.speed).toBeLessThanOrEqual(56.2);
  });

  it('uses only a gentle nudge for side contact', () => {
    const player = { ...createVehicle(100, 100, 0), speed: 70 };
    const result = resolvePlayerTraffic(player, [{ x: 100, y: 114, heading: 0, speed: 68 }]);
    expect(result.contact).toBeGreaterThan(0);
    expect(result.vehicle.y).toBeLessThan(100);
    expect(100 - result.vehicle.y).toBeLessThan(2);
    expect(result.vehicle.speed).toBeGreaterThan(68);
  });
});
