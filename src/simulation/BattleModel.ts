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

const BODY_LONGITUDINAL = 58;
const BODY_LATERAL = 25;
const PRESSURE_LONGITUDINAL = 82;
const PRESSURE_LATERAL = 40;

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
    const cos = Math.cos(car.heading);
    const sin = Math.sin(car.heading);
    const longitudinal = dx * cos + dy * sin;
    const lateral = -dx * sin + dy * cos;
    const absLong = Math.abs(longitudinal);
    const absLat = Math.abs(lateral);

    if (absLong > PRESSURE_LONGITUDINAL || absLat > PRESSURE_LATERAL) continue;

    const longPressure = 1 - absLong / PRESSURE_LONGITUDINAL;
    const latPressure = 1 - absLat / PRESSURE_LATERAL;
    pressure = Math.max(pressure, Math.max(0, Math.min(longPressure, latPressure)));

    if (absLong >= BODY_LONGITUDINAL || absLat >= BODY_LATERAL) continue;

    const longOverlap = BODY_LONGITUDINAL - absLong;
    const latOverlap = BODY_LATERAL - absLat;
    const contactStrength = Math.min(1, Math.max(longOverlap / BODY_LONGITUDINAL, latOverlap / BODY_LATERAL));
    contact = Math.max(contact, contactStrength);

    // Resolve through the cheapest axis. A nose-to-tail overlap pushes the
    // player longitudinally and scrubs speed; side contact mainly creates
    // lateral separation. This avoids radial "magnet" collisions.
    if (latOverlap < longOverlap * 0.65) {
      const side = lateral >= 0 ? 1 : -1;
      const separation = latOverlap + 1.5;
      x += -sin * side * separation;
      y += cos * side * separation;
    } else {
      const direction = longitudinal >= 0 ? 1 : -1;
      const separation = longOverlap * 0.72;
      x += cos * direction * separation;
      y += sin * direction * separation;
      const relativeSpeed = Math.max(0, speed - car.speed);
      speed = Math.max(0, speed - (1.2 + contactStrength * 4.8 + relativeSpeed * 0.12));
    }
  }

  return {
    vehicle: { ...vehicle, x, y, speed },
    pressure,
    contact,
  };
}
