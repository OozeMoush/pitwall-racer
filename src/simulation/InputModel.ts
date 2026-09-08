export function stepSteering(current: number, target: number, speed: number, dt: number): number {
  const clampedTarget = clamp(target, -1, 1);
  const speedNorm = clamp(speed / 95, 0, 1);
  const steeringRate = 7.6 - speedNorm * 3.4;
  const recenterBoost = Math.abs(clampedTarget) < 0.001 ? 1.55 : 1;
  const maxDelta = steeringRate * recenterBoost * Math.max(0, dt);

  if (Math.abs(clampedTarget - current) <= maxDelta) return clampedTarget;
  return clamp(current + Math.sign(clampedTarget - current) * maxDelta, -1, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
