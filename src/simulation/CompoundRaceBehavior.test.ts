import { describe, expect, it } from 'vitest';
import { controlArcadeCar } from './ArcadeCarController';
import { trackProfile } from './TrackProfile';

function sampledProfiles() {
  return Array.from({ length: 300 }, (_, index) => ({
    progress: index / 300,
    profile: trackProfile(index / 300, 1.08, 1),
  }));
}

describe('compound race behaviour', () => {
  it('keeps straight-line target speed nearly compound neutral', () => {
    const straight = sampledProfiles().reduce((best, sample) => sample.profile.severity < best.profile.severity ? sample : best);
    const soft = trackProfile(straight.progress, 1.08, 1.16);
    const medium = trackProfile(straight.progress, 1.08, 1.05);
    const hard = trackProfile(straight.progress, 1.08, 1.01);

    expect(Math.max(soft.targetSpeed, medium.targetSpeed, hard.targetSpeed)
      - Math.min(soft.targetSpeed, medium.targetSpeed, hard.targetSpeed)).toBeLessThan(2.5);
  });

  it('makes compounds separate through corner speed and apex reach without making Hard hopeless', () => {
    const corner = sampledProfiles().reduce((best, sample) => sample.profile.severity > best.profile.severity ? sample : best);
    const soft = trackProfile(corner.progress, 1.08, 1.16);
    const medium = trackProfile(corner.progress, 1.08, 1.05);
    const hard = trackProfile(corner.progress, 1.08, 1.01);

    expect(soft.targetSpeed).toBeGreaterThan(medium.targetSpeed + 4);
    expect(medium.targetSpeed).toBeGreaterThan(hard.targetSpeed + 1.5);
    expect(Math.abs(soft.apexOffset)).toBeGreaterThan(Math.abs(hard.apexOffset) + 0.6);
  });

  it('does not turn lower-grip tyres into weak engines on a straight', () => {
    const soft = controlArcadeCar(
      { vx: 72, vy: 0, heading: 0, angularVelocity: 0 },
      { throttle: 1, brake: 0, steer: 0, tireGrip: 1.16, powerBoost: 0.235 },
      0.1,
    );
    const hard = controlArcadeCar(
      { vx: 72, vy: 0, heading: 0, angularVelocity: 0 },
      { throttle: 1, brake: 0, steer: 0, tireGrip: 1.01, powerBoost: 0.235 },
      0.1,
    );

    expect(Math.abs(soft.acceleration - hard.acceleration)).toBeLessThan(0.25);
  });
});
