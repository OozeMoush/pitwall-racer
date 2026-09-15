import { describe, expect, it } from 'vitest';
import { safetyBarrierSegments } from './TrackBarrierModel';
import { TRACK_ROAD_HALF_WIDTH } from './TrackLimitsModel';
import { projectTrack } from './TrackModel';

describe('TrackBarrierModel', () => {
  it('keeps every chord-aligned wall piece outside the driveable road envelope', () => {
    const segments = safetyBarrierSegments();
    expect(segments.length).toBeGreaterThan(100);

    let closest = Infinity;
    for (const segment of segments) {
      const half = segment.length / 2;
      const cos = Math.cos(segment.heading);
      const sin = Math.sin(segment.heading);
      for (const ratio of [-1, -0.5, 0, 0.5, 1]) {
        const x = segment.x + cos * half * ratio;
        const y = segment.y + sin * half * ratio;
        closest = Math.min(closest, projectTrack(x, y).distance);
      }
    }

    // The barrier centre line must retain multiple metres of runoff beyond the
    // 17 m road edge. This specifically catches tangent/chord pieces poking back
    // into the hairpin like the visual snag reported in play.
    expect(closest).toBeGreaterThan(TRACK_ROAD_HALF_WIDTH + 3.5);
  });

  it('uses finite short segments instead of long midpoint tangents', () => {
    const segments = safetyBarrierSegments();
    expect(segments.every((segment) => Number.isFinite(segment.heading))).toBe(true);
    expect(Math.max(...segments.map((segment) => segment.length))).toBeLessThan(9);
  });
});
