import { describe, expect, it } from 'vitest';
import { RACING_LINE, TRACK_CONTROLS, TRACK_LENGTH, nearestTrackProgress, sampleTrack } from './TrackModel';

describe('TrackModel', () => {
  it('densifies the control polygon into a smooth racing line', () => {
    expect(RACING_LINE.length).toBeGreaterThan(TRACK_CONTROLS.length * 10);
    expect(TRACK_LENGTH).toBeGreaterThan(1000);
  });

  it('keeps heading changes small between nearby samples', () => {
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      const a = sampleTrack(i / 200);
      const b = sampleTrack((i + 1) / 200);
      let delta = Math.abs(a.heading - b.heading);
      if (delta > Math.PI) delta = Math.PI * 2 - delta;
      worst = Math.max(worst, delta);
    }
    expect(worst).toBeLessThan(0.22);
  });

  it('projects sampled points back close to their source progress', () => {
    for (const progress of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const point = sampleTrack(progress);
      const projected = nearestTrackProgress(point.x, point.y);
      expect(projected.distance).toBeLessThan(0.001);
      expect(Math.abs(projected.progress - progress)).toBeLessThan(0.002);
    }
  });
});
