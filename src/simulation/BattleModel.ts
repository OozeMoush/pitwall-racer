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

// Sized for the smaller 3D cars at the current world scale. These are race-game
// occupancy dimensions, not literal F1 metres.
const BODY_LONGITUDINAL = 38;
const BODY_LATERAL = 18;
const PRESSURE_LONGITUDINAL = 64;
const PRESSURE_LATERAL = 32;

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

    // The previous resolver teleported the player by most of the overlap every
    // 120 Hz tick. AI immediately moved back onto its abstract line, producing
    // visible buzzing. We now treat contact as soft space ownership: side rubs
    // nudge gently; nose-to-tail contact mostly caps closing speed.
    if (latOverlap < longOverlap * 0.7) {
      const side = lateral >= 0 ? 1 : -1;
      const separation = Math.min(1.2, latOverlap * 0.18);
      x += -sin * side * separation;
      y += cos * side * separation;
      speed = Math.max(0, speed - contactStrength * 0.5);
    } else {
      const playerBehind = longitudinal < 0;
      if (playerBehind) speed = Math.min(speed, car.speed + 1.2);
      else speed = Math.max(0, speed - contactStrength * 0.8);

      const direction = longitudinal >= 0 ? 1 : -1;
      const separation = Math.min(1.4, longOverlap * 0.1);
      x += cos * direction * separation;
      y += sin * direction * separation;
    }
  }

  return {
    vehicle: { ...vehicle, x, y, speed },
    pressure,
    contact,
  };
}
