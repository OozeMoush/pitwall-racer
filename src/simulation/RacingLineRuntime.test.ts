import { afterEach, describe, expect, it } from 'vitest';
import { referenceTarget } from './ReferenceDriverModel';
import { sampleTrack, trackLengthFor } from './TrackModel';
import {
  activeReferenceTarget,
  racingLineBrakeIntent,
  racingLineLocalBrakeIntent,
  racingLineThrottleIntent,
  racingLineTraceLapSeconds,
  sampleRuntimeRacingLinePose,
  setRuntimeRacingLine,
} from './RacingLineRuntime';

afterEach(() => {
  setRuntimeRacingLine('pitwall-gp', undefined);
});

describe('RacingLineRuntime', () => {
  it('computes a finite kinematic lap time from an explicit line asset', () => {
    const asset = {
      version: 1 as const,
      trackId: 'pitwall-gp' as const,
      source: 'PLAYER' as const,
      points: Array.from({ length: 320 }, (_, index) => ({
        progress: index / 320,
        laneOffset: 0,
        targetSpeed: 70,
      })),
    };

    const seconds = racingLineTraceLapSeconds(asset);
    expect(seconds).toBeDefined();
    expect(seconds!).toBeGreaterThan(5);
    const expected = trackLengthFor('pitwall-gp') / 70;
    expect(Math.abs(seconds! - expected) / expected).toBeLessThan(0.03);
  });

  it('interpolates demonstrated absolute heading continuously across start/finish', () => {
    const grip = 1.18;
    const bodyHeading = 0.65;
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 320 }, (_, index) => {
        const progress = index / 320;
        const centre = sampleTrack(progress);
        return {
          progress,
          laneOffset: 3,
          targetSpeed: 70,
          headingOffset: wrapTestAngle(bodyHeading - centre.heading),
          yawRate: 0,
        };
      }),
    });

    const before = sampleRuntimeRacingLinePose('pitwall-gp', 0.999);
    const after = sampleRuntimeRacingLinePose('pitwall-gp', 0.001);
    expect(before.demonstratedHeading).toBeDefined();
    expect(after.demonstratedHeading).toBeDefined();
    expect(Math.abs(wrapTestAngle(before.demonstratedHeading! - bodyHeading))).toBeLessThan(0.01);
    expect(Math.abs(wrapTestAngle(after.demonstratedHeading! - bodyHeading))).toBeLessThan(0.01);
  });

  it('uses the normal machine reference when no override is active', () => {
    const expected = referenceTarget('pitwall-gp', 0.37, 1.1);
    const actual = activeReferenceTarget('pitwall-gp', 0.37, 1.1);
    expect(actual.laneOffset).toBeCloseTo(expected.laneOffset);
    expect(actual.targetSpeed).toBeCloseTo(expected.targetSpeed);
  });

  it('derives early braking from a player speed profile instead of the old machine brake trace', () => {
    const grip = 1.1;
    const points = Array.from({ length: 160 }, (_, index) => {
      const progress = index / 160;
      return {
        progress,
        laneOffset: 0,
        targetSpeed: progress >= 0.34 && progress <= 0.48 ? 34 : 82,
      };
    });
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points,
    });

    const brake = racingLineBrakeIntent('pitwall-gp', 0.30, grip, 82);
    expect(brake).toBeGreaterThan(0.15);
  });

  it('derives local braking from the demonstrated speed derivative', () => {
    const grip = 1.1;
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 320 }, (_, index) => {
        const progress = index / 320;
        return {
          progress,
          laneOffset: 0,
          targetSpeed: progress < 0.30
            ? 82
            : progress < 0.40
              ? 82 - (progress - 0.30) * 400
              : 42,
        };
      }),
    });

    const brake = racingLineLocalBrakeIntent(
      'pitwall-gp',
      0.35,
      grip,
      62,
      0.25,
    );
    expect(brake).toBeGreaterThan(0.01);
    expect(brake).toBeLessThan(1);
  });

  it('adds extra local braking when replay arrives above the demonstrated speed', () => {
    const grip = 1.1;
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 320 }, (_, index) => {
        const progress = index / 320;
        return {
          progress,
          laneOffset: 0,
          targetSpeed: progress < 0.30
            ? 82
            : progress < 0.40
              ? 82 - (progress - 0.30) * 400
              : 42,
        };
      }),
    });

    const matched = racingLineLocalBrakeIntent(
      'pitwall-gp',
      0.35,
      grip,
      62,
      0.25,
    );
    const overspeed = racingLineLocalBrakeIntent(
      'pitwall-gp',
      0.35,
      grip,
      66,
      0.25,
    );

    expect(overspeed).toBeGreaterThan(matched);
  });

  it('derives sustaining throttle from a flat explicit speed trace', () => {
    const grip = 1.1;
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 160 }, (_, index) => ({
        progress: index / 160,
        laneOffset: 0,
        targetSpeed: 72,
      })),
    });

    const throttle = racingLineThrottleIntent(
      'pitwall-gp',
      0.25,
      grip,
      72,
      0,
    );
    expect(throttle).toBeGreaterThan(0.05);
    expect(throttle).toBeLessThan(1);
  });

  it('preserves the demonstrated player speed at the grip where it was recorded', () => {
    const grip = 1.1;
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 160 }, (_, index) => ({
        progress: index / 160,
        laneOffset: 0,
        targetSpeed: 34,
      })),
    });

    const target = activeReferenceTarget('pitwall-gp', 0.37, grip);
    expect(target.targetSpeed).toBeCloseTo(34, 6);
  });

  it('lets a selected asset own lane placement and relative speed intent', () => {
    const grip = 1.1;
    const baseline = referenceTarget('pitwall-gp', 0.25, grip);
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 4 }, (_, index) => ({
        progress: index / 4,
        laneOffset: 4,
        targetSpeed: baseline.targetSpeed * 0.9,
      })),
    });

    const target = activeReferenceTarget('pitwall-gp', 0.25, grip);
    expect(target.laneOffset).toBeCloseTo(4);
    expect(target.targetSpeed).toBeLessThan(baseline.targetSpeed);
  });
  it('prefers forward-axis acceleration over scalar speed derivative', () => {
    const grip = 1.2;
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 160 }, (_, index) => ({
        progress: index / 160,
        laneOffset: 0,
        targetSpeed: 60,
        tireGrip: grip,
        longitudinalAcceleration: 0.5,
        forwardAcceleration: 4.0,
      })),
    });

    const throttle = racingLineThrottleIntent(
      'pitwall-gp',
      0.4,
      grip,
      60,
      0.25,
    );
    expect(throttle).toBeGreaterThan(0.2);
  });

  it('does not reverse positive AXF into braking for a small replay overspeed', () => {
    const grip = 1.18;
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 320 }, (_, index) => ({
        progress: index / 320,
        laneOffset: 0,
        targetSpeed: 72,
        tireGrip: grip,
        forwardAcceleration: 7.5,
      })),
    });

    const brake = racingLineLocalBrakeIntent(
      'pitwall-gp',
      0.40,
      grip,
      73.5,
      0.05,
    );
    expect(brake).toBe(0);
  });

  it('preserves demonstrated AXF braking even when replay arrives underspeed', () => {
    const grip = 1.18;
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 320 }, (_, index) => ({
        progress: index / 320,
        laneOffset: 0,
        targetSpeed: 72,
        tireGrip: grip,
        forwardAcceleration: -7.5,
      })),
    });

    const brake = racingLineLocalBrakeIntent(
      'pitwall-gp',
      0.40,
      grip,
      66,
      0.05,
    );
    expect(brake).toBeGreaterThan(0.01);
  });

  it('still reproduces demonstrated negative AXF at matching speed', () => {
    const grip = 1.18;
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 320 }, (_, index) => ({
        progress: index / 320,
        laneOffset: 0,
        targetSpeed: 72,
        tireGrip: grip,
        forwardAcceleration: -7.5,
      })),
    });

    const brake = racingLineLocalBrakeIntent(
      'pitwall-gp',
      0.40,
      grip,
      72,
      0.05,
    );
    expect(brake).toBeGreaterThan(0.05);
  });

  it('uses demonstrated acceleration for source-grip throttle feed-forward', () => {
    const grip = 1.2;
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 160 }, (_, index) => ({
        progress: index / 160,
        laneOffset: 0,
        targetSpeed: 60,
        headingOffset: 0,
        yawRate: 0,
        longitudinalAcceleration: 3.5,
      })),
    });

    const throttle = racingLineThrottleIntent(
      'pitwall-gp',
      0.4,
      grip,
      60,
      0.2,
    );
    expect(throttle).toBeGreaterThan(0.1);
  });

  it('uses the pointwise demonstrated grip for explicit speed transfer', () => {
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: 1.1,
      points: Array.from({ length: 160 }, (_, index) => ({
        progress: index / 160,
        laneOffset: 0,
        targetSpeed: 70,
        tireGrip: 1.2,
      })),
    });

    const target = activeReferenceTarget('pitwall-gp', 0.25, 1.2);
    expect(target.targetSpeed).toBeCloseTo(70, 6);
  });


  it('does not rewrite a healthy periodic PLAYER seam', () => {
    const grip = 1.18;
    const points = Array.from({ length: 320 }, (_, index) => {
      const progress = index / 320;
      const laneOffset = 4 + Math.sin(progress * Math.PI * 2) * 2.5;
      const pose = sampleTrack(progress, laneOffset);
      return {
        progress,
        laneOffset,
        targetSpeed: 70,
        worldX: pose.x,
        worldY: pose.y,
        bodyHeading: pose.heading,
        headingOffset: 0,
        yawRate: 0,
        tireGrip: grip,
      };
    });
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points,
    });

    for (const progress of [0.996, 0.999, 0.001, 0.004]) {
      const target = activeReferenceTarget('pitwall-gp', progress, grip);
      const expectedLane = 4 + Math.sin(progress * Math.PI * 2) * 2.5;
      expect(target.laneOffset).toBeCloseTo(expectedLane, 1);
    }
  });

  it('keeps the stored wrap from becoming a tiny angular corner', () => {
    const grip = 1.18;
    const points = Array.from({ length: 320 }, (_, index) => {
      const progress = index / 320;
      const laneOffset = 3 + Math.sin(progress * Math.PI * 2) * 1.5;
      const pose = sampleTrack(progress, laneOffset);
      return {
        progress,
        laneOffset,
        targetSpeed: 70,
        worldX: pose.x,
        worldY: pose.y,
        bodyHeading: pose.heading,
        headingOffset: 0,
        yawRate: 0,
        tireGrip: grip,
      };
    });
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points,
    });

    const before = sampleRuntimeRacingLinePose('pitwall-gp', 0.9995);
    const after = sampleRuntimeRacingLinePose('pitwall-gp', 0.0005);
    expect(Math.abs(wrapTestAngle(
      after.trajectoryHeading - before.trajectoryHeading,
    ))).toBeLessThan(0.16);
  });

  it('smooths a discontinuous lane schedule through start-finish', () => {
    const grip = 1.18;
    setRuntimeRacingLine('pitwall-gp', {
      version: 1,
      trackId: 'pitwall-gp',
      source: 'PLAYER',
      referenceGrip: grip,
      points: Array.from({ length: 320 }, (_, index) => {
        const progress = index / 320;
        const laneOffset = progress > 0.97
          ? -12
          : progress < 0.03
            ? 12
            : 0;
        const pose = sampleTrack(progress, laneOffset);
        return {
          progress,
          laneOffset,
          targetSpeed: 70,
          worldX: pose.x,
          worldY: pose.y,
          bodyHeading: pose.heading,
          headingOffset: 0,
          yawRate: 0,
          tireGrip: grip,
        };
      }),
    });

    const before = activeReferenceTarget('pitwall-gp', 0.999, grip);
    const after = activeReferenceTarget('pitwall-gp', 0.001, grip);
    expect(Math.abs(after.laneOffset - before.laneOffset)).toBeLessThan(4);

    const beforePose = sampleRuntimeRacingLinePose('pitwall-gp', 0.999);
    const afterPose = sampleRuntimeRacingLinePose('pitwall-gp', 0.001);
    expect(Math.hypot(
      afterPose.x - beforePose.x,
      afterPose.y - beforePose.y,
    )).toBeLessThan(30);
  });

});

function wrapTestAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}
