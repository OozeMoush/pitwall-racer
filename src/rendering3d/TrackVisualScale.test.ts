import { describe, expect, it } from 'vitest';
import {
  BARRIER_SEGMENT_METRES,
  EDGE_LINE_WIDTH_METRES,
  KERB_SEGMENT_METRES,
  ROAD_HALF_WIDTH,
  SPEED_REFERENCE_SPACING_METRES,
} from './Track3D';

describe('track visual scale', () => {
  it('uses kerb blocks sized for the miniature lap rather than the old full-size circuit', () => {
    expect(KERB_SEGMENT_METRES).toBeGreaterThanOrEqual(4);
    expect(KERB_SEGMENT_METRES).toBeLessThanOrEqual(8);
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
