import type { VehicleState } from './VehicleModel';

export interface TrafficCarPose {
  x: number;
  y: number;
  heading: number;
  speed: number;
}

export interface TrafficResolution {
  vehicle: VehicleState;
  pressure: number;
  contact: number;
}

export function resolvePlayerTraffic(
  vehicle: VehicleState,
  traffic: readonly TrafficCarPose[],
): TrafficResolution {
  let x = vehicle.x;
  let y = vehicle.y;
  let speed = vehicle.speed;
  let pressure = 0;
  let contact = 0;

  for (const car of traffic) {
    const dx = x - car.x;
    const dy = y - car.y;
    const distance = Math.max(0.001, Math.hypot(dx, dy));
    if (distance > 42) continue;

    pressure = Math.max(pressure, 1 - distance / 42);

    // Cars start respecting each other's space before sprites overlap. This is an
    // arcade handling rule, not rigid-body collision physics.
    if (distance < 30) {
      const overlap = 30 - distance;
      const nx = dx / distance;
      const ny = dy / distance;
      const separation = overlap * 0.58;
      x += nx * separation;
      y += ny * separation;

      contact = Math.max(contact, overlap / 30);
      const relativeSpeed = Math.max(0, speed - car.speed);
      const contactLoss = 0.7 + contact * 2.8 + relativeSpeed * 0.08;
      speed = Math.max(0, speed - contactLoss);
    }
  }

  return {
    vehicle: { ...vehicle, x, y, speed },
    pressure,
    contact,
  };
}
