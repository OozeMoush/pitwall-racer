import { afterEach, describe, expect, it } from 'vitest';
import {
  MINIATURE_TRACK_SCALE,
  RACING_LINE,
  TRACK_CONTROLS,
  TRACK_LENGTH,
  TRACKS,
  crossedStartLine,
  nearestTrackProgress,
  projectTrack,
  projectTrackNear,
  sampleTrack,
  samplesForDistance,
  setActiveTrack,
} from './TrackModel';

afterEach(() => setActiveTrack('pitwall-gp'));

describe('TrackModel', () => {
  it('builds Pitwall GP as a full race-scale circuit while retaining dense geometry', () => {
    expect(MINIATURE_TRACK_SCALE).toBeGreaterThanOrEqual(0.35);
    expect(MINIATURE_TRACK_SCALE).toBeLessThanOrEqual(0.5);
    expect(RACING_LINE.length).toBeGreaterThan(TRACK_CONTROLS.length * 10);
    expect(TRACK_LENGTH).toBeGreaterThan(7800);
    expect(TRACK_LENGTH).toBeLessThan(8400);
  });

  it('supports multiple race-scale circuits alongside legacy miniature circuits', () => {
    const lengths = TRACKS.map((track) => {
      setActiveTrack(track.id);
      expect(RACING_LINE.length).toBeGreaterThan(track.controls.length * 10);
      if (track.id === 'pitwall-gp') {
        expect(TRACK_LENGTH).toBeGreaterThan(7800);
        expect(TRACK_LENGTH).toBeLessThan(8400);
      } else if (track.id === 'baku-street') {
        expect(TRACK_LENGTH).toBeGreaterThan(5500);
        expect(TRACK_LENGTH).toBeLessThan(6500);
      } else if (track.id === 'velocity-park') {
        expect(TRACK_LENGTH).toBeGreaterThan(7800);
        expect(TRACK_LENGTH).toBeLessThan(9000);
      } else if (track.id === 'switchback-ring') {
        expect(TRACK_LENGTH).toBeGreaterThan(7000);
        expect(TRACK_LENGTH).toBeLessThan(8500);
      } else if (track.id === 'sakura-esses') {
        expect(TRACK_LENGTH).toBeGreaterThan(7000);
        expect(TRACK_LENGTH).toBeLessThan(8500);
      } else if (track.id === 'harbor-chicane') {
        expect(TRACK_LENGTH).toBeGreaterThan(7000);
        expect(TRACK_LENGTH).toBeLessThan(8500);
      } else {
        expect(TRACK_LENGTH).toBeGreaterThan(1400);
        expect(TRACK_LENGTH).toBeLessThan(2600);
      }
      return Math.round(TRACK_LENGTH);
    });
    expect(new Set(lengths).size).toBeGreaterThanOrEqual(3);
  });

  it('includes a Baku street circuit with the real long-straight/city silhouette', () => {
    setActiveTrack('baku-street');
    const circuit = TRACKS.find((entry) => entry.id === 'baku-street');
    expect(circuit?.geometry).toBe('street');
    expect(circuit?.controls.length).toBeGreaterThanOrEqual(30);
    expect(TRACK_LENGTH).toBeGreaterThan(5500);
    expect(TRACK_LENGTH).toBeLessThan(6500);

    const samples = Array.from({ length: 240 }, (_, index) => sampleTrack(index / 240));
    expect(hasNonAdjacentCrossing(samples)).toBe(false);

    const xs = samples.map((point) => point.x);
    const ys = samples.map((point) => point.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1700);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1200);
  });

  it('has no discontinuous heading jumps around every closed circuit', () => {
    for (const track of TRACKS) {
      setActiveTrack(track.id);
      let worst = 0;
      const sampleCount = samplesForDistance(TRACK_LENGTH, 8, 240, 2000);
      for (let i = 0; i < sampleCount; i++) {
        const a = sampleTrack(i / sampleCount);
        const b = sampleTrack((i + 1) / sampleCount);
        let delta = Math.abs(a.heading - b.heading);
        if (delta > Math.PI) delta = Math.PI * 2 - delta;
        worst = Math.max(worst, delta);
      }
      expect(worst).toBeLessThan(1.05);
    }
  });

  it('detects a start-line wrap without requiring a narrow progress window', () => {
    expect(crossedStartLine(0.97, 0.03)).toBe(true);
    expect(crossedStartLine(0.86, 0.04)).toBe(true);
    expect(crossedStartLine(0.61, 0.42)).toBe(false);
    expect(crossedStartLine(0.12, 0.18)).toBe(false);
  });

  it('projects sampled points back close to their source progress', () => {
    for (const progress of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      const point = sampleTrack(progress);
      const projected = nearestTrackProgress(point.x, point.y);
      expect(projected.distance).toBeLessThan(0.001);
      expect(Math.abs(projected.progress - progress)).toBeLessThan(0.002);
    }
  });

  it('keeps a displaced car on the correct branch of the spread-out Pitwall layout', () => {
    const sourceProgress = 0.56;
    const point = sampleTrack(sourceProgress, -24);
    const globalProjection = projectTrack(point.x, point.y);
    const localProjection = projectTrackNear(point.x, point.y, sourceProgress);

    // Pitwall GP 2.0 deliberately separates the formerly overlapping branches.
    // Both global and continuity-aware projection should now agree on the road.
    expect(Math.abs(globalProjection.progress - sourceProgress)).toBeLessThan(0.006);
    expect(Math.abs(localProjection.progress - sourceProgress)).toBeLessThan(0.006);
    expect(localProjection.laneOffset).toBeLessThan(-18);
  });

  it('keeps Sakura kerb attacks on the same progress branch', () => {
    setActiveTrack('sakura-esses');
    for (let index = 0; index < 80; index++) {
      const progress = index / 80;
      for (const laneOffset of [-19, 19]) {
        const point = sampleTrack(progress, laneOffset);
        const projected = projectTrackNear(point.x, point.y, progress, 1.35);
        const delta = Math.abs(projected.progress - progress);
        const circularDelta = Math.min(delta, 1 - delta);
        expect(circularDelta).toBeLessThan(0.012);
      }
    }
  });

  it('abandons a stale continuity branch when the real road is clearly nearer', () => {
    setActiveTrack('pitwall-gp');
    const actualProgress = 0.31;
    const point = sampleTrack(actualProgress, 0);
    const projected = projectTrackNear(point.x, point.y, 0.92, 1.35);
    const delta = Math.abs(projected.progress - actualProgress);
    const circularDelta = Math.min(delta, 1 - delta);
    expect(circularDelta).toBeLessThan(0.02);
    expect(projected.distance).toBeLessThan(1);
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
function hasNonAdjacentCrossing(points: readonly { x: number; y: number }[]): boolean {
  const count = points.length;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % count];
    for (let j = i + 2; j < count; j++) {
      if (i === 0 && j === count - 1) continue;
      const c = points[j];
      const d = points[(j + 1) % count];
      if (segmentsCross(a, b, c, d)) return true;
    }
  }
  return false;
}

function segmentsCross(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): boolean {
  const cross = (
    p: { x: number; y: number },
    q: { x: number; y: number },
    r: { x: number; y: number },
  ) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return abC * abD < -1e-6 && cdA * cdB < -1e-6;
}
