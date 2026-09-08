import { describe, expect, it } from 'vitest';
import { controlArcadeCar } from './ArcadeCarController';

function stepSpeed(seconds: number, powerBoost = 0): number {
  let vx = 0;
  let vy = 0;
  let heading = 0;
  let angularVelocity = 0;
  const dt = 1 / 120;
  for (let t = 0; t < seconds; t += dt) {
    const next = controlArcadeCar(
      { vx, vy, heading, angularVelocity },
      { throttle: 1, brake: 0, steer: 0, tireGrip: 1, powerBoost },
      dt,
    );
    vx = next.vx;
    vy = next.vy;
    angularVelocity = next.angularVelocity;
    heading += angularVelocity * dt;
  }
  return Math.hypot(vx, vy);
}

describe('ArcadeCarController', () => {
  it('builds speed progressively instead of jumping to the speed ceiling', () => {
    const afterOne = stepSpeed(1);
    const afterFive = stepSpeed(5);
    const afterTen = stepSpeed(10);

    expect(afterOne).toBeGreaterThan(8);
    expect(afterOne).toBeLessThan(20);
    expect(afterFive).toBeGreaterThan(afterOne * 2.2);
    expect(afterTen).toBeGreaterThan(afterFive);
  });

  it('makes deploy meaningfully faster than harvest over a long acceleration zone', () => {
    const harvest = stepSpeed(9, -0.16);
    const normal = stepSpeed(9, 0.065);
    const deploy = stepSpeed(9, 0.31);

    expect(harvest).toBeLessThan(normal - 3);
    expect(deploy).toBeGreaterThan(normal + 3);
  });

  it('requires much larger turning radius at high speed', () => {
    const medium = controlArcadeCar(
      { vx: 55, vy: 0, heading: 0, angularVelocity: 0 },
      { throttle: 0, brake: 0, steer: 1, tireGrip: 1 },
      0.1,
    );
    const high = controlArcadeCar(
      { vx: 100, vy: 0, heading: 0, angularVelocity: 0 },
      { throttle: 0, brake: 0, steer: 1, tireGrip: 1 },
      0.1,
    );

    expect(Math.abs(high.angularVelocity)).toBeLessThan(Math.abs(medium.angularVelocity) * 0.62);
  });

  it('braking removes speed decisively without instantly reversing the car', () => {
    const next = controlArcadeCar(
      { vx: 80, vy: 0, heading: 0, angularVelocity: 0 },
      { throttle: 0, brake: 1, steer: 0, tireGrip: 1 },
      0.5,
    );

    expect(next.vx).toBeLessThan(70);
    expect(next.vx).toBeGreaterThanOrEqual(0);
  });
});
