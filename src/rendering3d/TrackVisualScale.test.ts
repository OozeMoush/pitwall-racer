import { afterEach, describe, expect, it } from 'vitest';
import {
  BARRIER_SEGMENT_METRES,
  EDGE_LINE_WIDTH_METRES,
  KERB_SEGMENT_METRES,
  ROAD_HALF_WIDTH,
  SPEED_REFERENCE_SPACING_METRES,
  trackMeshSampleCount,
} from './Track3D';
import { samplesForDistance, setActiveTrack } from '../simulation/TrackModel';

afterEach(() => setActiveTrack('pitwall-gp'));

describe('track visual scale', () => {
  it('scales road-mesh resolution with circuit metres', () => {
    setActiveTrack('pitwall-gp');
    const pitwallSamples = trackMeshSampleCount();
    setActiveTrack('baku-street');
    const bakuSamples = trackMeshSampleCount();
    expect(pitwallSamples).toBeGreaterThanOrEqual(460);
    expect(bakuSamples).toBeGreaterThanOrEqual(pitwallSamples);
    expect(samplesForDistance(7000, 5, 460)).toBe(1400);
  });

  it('uses kerb blocks sized for the current circuit scale', () => {
    expect(KERB_SEGMENT_METRES).toBeGreaterThanOrEqual(2.5);
    expect(KERB_SEGMENT_METRES).toBeLessThanOrEqual(6);
  });

  it('keeps edge lines readable at race speed', () => {
    expect(EDGE_LINE_WIDTH_METRES).toBeGreaterThanOrEqual(0.65);
  });

  it('keeps the road narrow enough that line choice matters', () => {
    expect(ROAD_HALF_WIDTH).toBeGreaterThanOrEqual(14);
    expect(ROAD_HALF_WIDTH).toBeLessThanOrEqual(17);
  });

  it('uses short wall and reference segments that can follow the tighter miniature curves', () => {
    expect(BARRIER_SEGMENT_METRES).toBeGreaterThanOrEqual(5);
    expect(BARRIER_SEGMENT_METRES).toBeLessThanOrEqual(8);
    expect(SPEED_REFERENCE_SPACING_METRES).toBeGreaterThanOrEqual(9);
    expect(SPEED_REFERENCE_SPACING_METRES).toBeLessThanOrEqual(16);
  });
});
