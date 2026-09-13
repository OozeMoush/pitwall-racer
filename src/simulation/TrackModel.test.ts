import { afterEach, describe, expect, it } from 'vitest';
import {
  MINIATURE_TRACK_SCALE,
  RACING_LINE,
  TRACK_CONTROLS,
  TRACK_LENGTH,
  TRACKS,
  nearestTrackProgress,
  projectTrack,
  sampleTrack,
  setActiveTrack,
} from './TrackModel';

afterEach(() => setActiveTrack('pitwall-gp'));

describe('TrackModel', () => {
  it('densifies a miniature circuit into a smooth racing line', () => {
    expect(MINIATURE_TRACK_SCALE).toBeGreaterThanOrEqual(0.35);
    expect(MINIATURE_TRACK_SCALE).toBeLessThanOrEqual(0.5);
    expect(RACING_LINE.length).toBeGreaterThan(TRACK_CONTROLS.length * 10);
    expect(TRACK_LENGTH).toBeGreaterThan(1800);
    expect(TRACK_LENGTH).toBeLessThan(2400);
  });

  it('ships multiple genuinely different miniature circuits', () => {
    const lengths = TRACKS.map((track) => {
      setActiveTrack(track.id);
      expect(RACING_LINE.length).toBeGreaterThan(track.controls.length * 10);
      expect(TRACK_LENGTH).toBeGreaterThan(1400);
      expect(TRACK_LENGTH).toBeLessThan(2600);
      return Math.round(TRACK_LENGTH);
    });
    expect(new Set(lengths).size).toBeGreaterThanOrEqual(3);
  });

  it('has no discontinuous heading jumps around every closed circuit', () => {
    for (const track of TRACKS) {
      setActiveTrack(track.id);
      let worst = 0;
      for (let i = 0; i < 240; i++) {
        const a = sampleTrack(i / 240);
        const b = sampleTrack((i + 1) / 240);
        let delta = Math.abs(a.heading - b.heading);
        if (delta > Math.PI) delta = Math.PI * 2 - delta;
        worst = Math.max(worst, delta);
      }
      expect(worst).toBeLessThan(1.05);
    }
  });

  it('projects sampled points back close to their source progress', () => {
    for (const progress of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const point = sampleTrack(progress);
      const projected = nearestTrackProgress(point.x, point.y);
      expect(projected.distance).toBeLessThan(0.001);
      expect(Math.abs(projected.progress - progress)).toBeLessThan(0.002);
    }
  });

  it('preserves the signed lateral side of a car on the circuit', () => {
    for (const progress of [0.12, 0.44, 0.78]) {
      const left = sampleTrack(progress, 18);
      const right = sampleTrack(progress, -18);
      const leftProjection = projectTrack(left.x, left.y);
      const rightProjection = projectTrack(right.x, right.y);
      expect(leftProjection.laneOffset).toBeGreaterThan(13);
      expect(rightProjection.laneOffset).toBeLessThan(-13);
    }
  });
});
