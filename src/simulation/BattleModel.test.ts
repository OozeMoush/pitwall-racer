import { describe, expect, it } from 'vitest';
import { resolvePlayerTraffic } from './BattleModel';
import { createVehicle } from './VehicleModel';

describe('BattleModel', () => {
  it('reports pressure before contact', () => {
    const player = { ...createVehicle(100, 100, 0), speed: 60 };
    const result = resolvePlayerTraffic(player, [{ x: 170, y: 100, heading: 0, speed: 58 }]);
    expect(result.pressure).toBeGreaterThan(0);
    expect(result.contact).toBe(0);
  });

  it('separates nose-to-tail overlaps and scrubs speed', () => {
    const player = { ...createVehicle(100, 100, 0), speed: 70 };
    const result = resolvePlayerTraffic(player, [{ x: 138, y: 100, heading: 0, speed: 55 }]);
    expect(result.contact).toBeGreaterThan(0);
    expect(result.vehicle.x).toBeLessThan(100);
    expect(result.vehicle.speed).toBeLessThan(70);
  });

  it('separates side overlap without treating it like a rear-end hit', () => {
    const player = { ...createVehicle(100, 100, 0), speed: 70 };
    const result = resolvePlayerTraffic(player, [{ x: 100, y: 118, heading: 0, speed: 68 }]);
    expect(result.contact).toBeGreaterThan(0);
    expect(result.vehicle.y).toBeLessThan(100);
    expect(result.vehicle.speed).toBeGreaterThan(65);
  });
});
