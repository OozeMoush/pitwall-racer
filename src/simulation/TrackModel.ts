export interface TrackPoint { x: number; y: number }

export interface TrackProjection {
  progress: number;
  distance: number;
  laneOffset: number;
  heading: number;
  x: number;
  y: number;
}

// Clockwise fictional circuit built around the actual driving game rather than
// around a compact technical demo. The long bottom straight lets the car reach
// meaningful speed before a real braking event. The upper half then mixes a
// fast sweep with two slower direction changes and a tight left-side complex.
// At normal race pace the lap should contain obvious "flat / brake / rotate /
// accelerate" phases instead of being one continuous full-throttle corner.
export const TRACK_CONTROLS: readonly TrackPoint[] = [
  { x: 250, y: 930 },
  { x: 650, y: 930 },
  { x: 1100, y: 930 },
  { x: 1500, y: 925 },
  { x: 1750, y: 900 },
  { x: 1900, y: 840 },
  { x: 1970, y: 740 },
  { x: 1960, y: 640 },
  { x: 1900, y: 560 },
  { x: 1800, y: 500 },
  { x: 1650, y: 470 },
  { x: 1500, y: 470 },
  { x: 1360, y: 520 },
  { x: 1240, y: 540 },
  { x: 1100, y: 500 },
  { x: 980, y: 400 },
  { x: 840, y: 300 },
  { x: 660, y: 260 },
  { x: 500, y: 300 },
  { x: 380, y: 390 },
  { x: 330, y: 500 },
  { x: 360, y: 610 },
  { x: 460, y: 670 },
  { x: 600, y: 650 },
  { x: 720, y: 600 },
  { x: 800, y: 650 },
  { x: 820, y: 760 },
  { x: 760, y: 840 },
  { x: 620, y: 875 },
  { x: 450, y: 860 },
  { x: 320, y: 875 },
];

const SAMPLES_PER_CONTROL = 24;

export const RACING_LINE: readonly TrackPoint[] = buildClosedCatmullRom(TRACK_CONTROLS, SAMPLES_PER_CONTROL);

interface Segment { a: TrackPoint; b: TrackPoint; length: number; start: number }

const segments: Segment[] = [];
let total = 0;
for (let i = 0; i < RACING_LINE.length; i++) {
  const a = RACING_LINE[i];
  const b = RACING_LINE[(i + 1) % RACING_LINE.length];
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  segments.push({ a, b, length, start: total });
  total += length;
}

export const TRACK_LENGTH = total;

export function sampleTrack(progress: number, laneOffset = 0): TrackPoint & { heading: number } {
  const p = ((progress % 1) + 1) % 1;
  const distance = p * TRACK_LENGTH;
  const segment = segmentAtDistance(distance);
  const t = Math.max(0, Math.min(1, (distance - segment.start) / segment.length));
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const heading = Math.atan2(dy, dx);
  const nx = -Math.sin(heading);
  const ny = Math.cos(heading);
  return {
    x: segment.a.x + dx * t + nx * laneOffset,
    y: segment.a.y + dy * t + ny * laneOffset,
    heading,
  };
}

export function projectTrack(x: number, y: number): TrackProjection {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  let bestX = 0;
  let bestY = 0;
  let bestHeading = 0;
  let bestLaneOffset = 0;

  for (const s of segments) {
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - s.a.x) * dx + (y - s.a.y) * dy) / lenSq));
    const px = s.a.x + dx * t;
    const py = s.a.y + dy * t;
    const distance = Math.hypot(x - px, y - py);
    if (distance < bestDistance) {
      const heading = Math.atan2(dy, dx);
      const nx = -Math.sin(heading);
      const ny = Math.cos(heading);
      bestDistance = distance;
      bestAlong = s.start + s.length * t;
      bestX = px;
      bestY = py;
      bestHeading = heading;
      bestLaneOffset = (x - px) * nx + (y - py) * ny;
    }
  }

  return {
    progress: bestAlong / TRACK_LENGTH,
    distance: bestDistance,
    laneOffset: bestLaneOffset,
    heading: bestHeading,
    x: bestX,
    y: bestY,
  };
}

export function nearestTrackProgress(x: number, y: number): { progress: number; distance: number } {
  const projection = projectTrack(x, y);
  return { progress: projection.progress, distance: projection.distance };
}

function segmentAtDistance(distance: number): Segment {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const segment = segments[mid];
    if (distance < segment.start) high = mid - 1;
    else if (distance > segment.start + segment.length) low = mid + 1;
    else return segment;
  }
  return segments[segments.length - 1];
}

function buildClosedCatmullRom(points: readonly TrackPoint[], samplesPerControl: number): TrackPoint[] {
  const result: TrackPoint[] = [];
  const count = points.length;
  for (let i = 0; i < count; i++) {
    const p0 = points[(i - 1 + count) % count];
    const p1 = points[i];
    const p2 = points[(i + 1) % count];
    const p3 = points[(i + 2) % count];

    for (let sample = 0; sample < samplesPerControl; sample++) {
      const t = sample / samplesPerControl;
      const t2 = t * t;
      const t3 = t2 * t;
      result.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return result;
}
