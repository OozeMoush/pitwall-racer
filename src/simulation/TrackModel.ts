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
// around a compact technical demo. The bottom straight is deliberately long,
// but the lap now also contains a proper braking corner, a technical upper
// sector and a late S sequence so holding W is not a complete driving strategy.
export const TRACK_CONTROLS: readonly TrackPoint[] = [
  { x: 582, y: 930 },
  { x: 1100, y: 930 },
  { x: 1580, y: 930 },
  { x: 1900, y: 920 },
  { x: 2070, y: 900 },
  { x: 2160, y: 840 },
  { x: 2180, y: 760 },
  { x: 2140, y: 690 },
  { x: 2050, y: 640 },
  { x: 1920, y: 620 },
  { x: 1760, y: 620 },
  { x: 1620, y: 590 },
  { x: 1500, y: 520 },
  { x: 1435, y: 430 },
  { x: 1485, y: 345 },
  { x: 1410, y: 285 },
  { x: 1260, y: 285 },
  { x: 1140, y: 350 },
  { x: 1040, y: 440 },
  { x: 910, y: 485 },
  { x: 800, y: 435 },
  { x: 715, y: 340 },
  { x: 590, y: 285 },
  { x: 440, y: 300 },
  { x: 310, y: 365 },
  { x: 225, y: 470 },
  { x: 230, y: 585 },
  { x: 300, y: 665 },
  { x: 245, y: 745 },
  { x: 300, y: 835 },
  { x: 430, y: 900 },
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
