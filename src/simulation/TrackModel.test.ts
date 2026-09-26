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

  it('includes a Baku-style long street circuit with a dense city section', () => {
    setActiveTrack('baku-street');
    const circuit = TRACKS.find((entry) => entry.id === 'baku-street');
    expect(circuit?.controls.length).toBeGreaterThanOrEqual(30);
    expect(TRACK_LENGTH).toBeGreaterThan(2100);
    expect(TRACK_LENGTH).toBeLessThan(2450);
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

  it('keeps a displaced car on its current branch when nearby track sections overlap spatially', () => {
    const sourceProgress = 0.56;
    const point = sampleTrack(sourceProgress, -24);
    const globalProjection = projectTrack(point.x, point.y);
    const localProjection = projectTrackNear(point.x, point.y, sourceProgress);

    // The miniature Pitwall GP folds another part of the circuit close enough
    // that nearest-point projection legitimately finds the wrong branch here.
    expect(Math.abs(globalProjection.progress - sourceProgress)).toBeGreaterThan(0.01);
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