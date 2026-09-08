import { describe, expect, it } from 'vitest';
import { trackProfile } from './TrackProfile';

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

  it('moves the racing line toward the inside of meaningful corners', () => {
    const corner = sampleProfiles().reduce((best, sample) => sample.profile.severity > best.profile.severity ? sample : best);
    expect(corner.profile.severity).toBeGreaterThan(0.6);
    expect(Math.abs(corner.profile.apexOffset)).toBeGreaterThan(7);
    expect(Math.sign(corner.profile.apexOffset)).toBe(Math.sign(corner.profile.signedTurn));
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
