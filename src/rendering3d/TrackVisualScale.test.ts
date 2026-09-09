import { describe, expect, it } from 'vitest';
import {
  BARRIER_SEGMENT_METRES,
  EDGE_LINE_WIDTH_METRES,
  KERB_SEGMENT_METRES,
  SPEED_REFERENCE_SPACING_METRES,
} from './Track3D';

describe('track visual scale', () => {
  it('uses broad continuous-looking kerb blocks instead of tiny confetti pieces', () => {
    expect(KERB_SEGMENT_METRES).toBeGreaterThanOrEqual(9);
    expect(KERB_SEGMENT_METRES).toBeLessThanOrEqual(16);
  });

  it('keeps edge lines readable at race speed', () => {
    expect(EDGE_LINE_WIDTH_METRES).toBeGreaterThanOrEqual(0.65);
  });

  it('spaces trackside detail far enough apart to avoid high-speed shimmer', () => {
    expect(SPEED_REFERENCE_SPACING_METRES).toBeGreaterThanOrEqual(20);
    expect(BARRIER_SEGMENT_METRES).toBeGreaterThanOrEqual(18);
  });
});
