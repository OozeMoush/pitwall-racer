import { describe, expect, it } from 'vitest';
import { racingLineOffset, signedHeadingDelta, trackProfile } from './TrackProfile';
import { raceScaleDistance, TRACK_LENGTH } from './TrackModel';

function sampleProfiles() {
  return Array.from({ length: 240 }, (_, index) => ({
    progress: index / 240,
    profile: trackProfile(index / 240),
  }));
}

describe('TrackProfile', () => {
  it('creates materially different straight and corner target speeds', () => {
    const profiles = sampleProfiles();
    const fastest = profiles.reduce((best, sample) => sample.profile.targetSpeed > best.profile.targetSpeed ? sample : best);
    const slowest = profiles.reduce((best, sample) => sample.profile.targetSpeed < best.profile.targetSpeed ? sample : best);

    expect(fastest.profile.targetSpeed).toBeGreaterThan(95);
    expect(slowest.profile.targetSpeed).toBeLessThan(70);
    expect(fastest.profile.targetSpeed - slowest.profile.targetSpeed).toBeGreaterThan(28);
  });

  it('moves the apex target toward the inside of meaningful corners', () => {
    const corner = sampleProfiles().reduce((best, sample) => sample.profile.severity > best.profile.severity ? sample : best);
    expect(corner.profile.severity).toBeGreaterThan(0.6);
    expect(Math.abs(corner.profile.apexOffset)).toBeGreaterThan(7);
    expect(Math.sign(corner.profile.apexOffset)).toBe(Math.sign(corner.profile.signedTurn));
  });

  it('builds an outside-apex-outside line instead of hugging the inside all corner', () => {
    const metres = (value: number) => raceScaleDistance(value) / TRACK_LENGTH;
    const local = Array.from({ length: 360 }, (_, index) => {
      const progress = index / 360;
      return {
        progress,
        turn: signedHeadingDelta(progress - metres(18), progress + metres(18)),
      };
    });
    const apex = local.reduce((best, sample) => Math.abs(sample.turn) > Math.abs(best.turn) ? sample : best);
    const apexOffset = racingLineOffset(apex.progress, 1.06);
    const approaches = [110, 90, 70, 50, 30]
      .map((distance) => racingLineOffset(apex.progress - metres(distance), 1.06));

    expect(Math.abs(apexOffset)).toBeGreaterThan(4.5);
    expect(Math.sign(apexOffset)).toBe(Math.sign(apex.turn));
    expect(approaches.some((offset) => Math.abs(offset) > 2.5 && Math.sign(offset) === -Math.sign(apex.turn))).toBe(true);
  });

  it('keeps the requested racing line continuous around the miniature lap', () => {
    const offsets = Array.from({ length: 720 }, (_, index) => racingLineOffset(index / 720, 1.06));
    let worstJump = 0;
    for (let i = 0; i < offsets.length; i++) {
      const next = offsets[(i + 1) % offsets.length];
      worstJump = Math.max(worstJump, Math.abs(next - offsets[i]));
    }
    expect(worstJump).toBeLessThan(3);
  });

  it('lets stronger drivers carry a little more corner speed without changing the track', () => {
    const profiles = sampleProfiles();
    const corner = profiles.reduce((best, sample) => sample.profile.severity > best.profile.severity ? sample : best);
    const cautious = trackProfile(corner.progress, 0.94, 1);
    const quick = trackProfile(corner.progress, 1.08, 1);
    expect(quick.targetSpeed).toBeGreaterThan(cautious.targetSpeed);
    expect(quick.targetSpeed - cautious.targetSpeed).toBeLessThan(12);
  });
});
