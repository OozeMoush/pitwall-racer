export interface TrackPoint { x: number; y: number }

// Clockwise authored circuit. Point zero sits on the main straight.
// The layout deliberately mixes a long straight, a heavy-braking right side,
// a fast upper section and a technical left-side sequence so driving line and
// braking matter before strategy systems do.
export const TRACK_CONTROLS: readonly TrackPoint[] = [
  { x: 430, y: 780 },
  { x: 700, y: 790 },
  { x: 1030, y: 775 },
  { x: 1260, y: 715 },
  { x: 1360, y: 600 },
  { x: 1340, y: 470 },
  { x: 1230, y: 390 },
  { x: 1080, y: 400 },
  { x: 980, y: 340 },
  { x: 1020, y: 245 },
  { x: 900, y: 190 },
  { x: 720, y: 205 },
  { x: 610, y: 290 },
  { x: 560, y: 380 },
  { x: 470, y: 345 },
  { x: 350, y: 380 },
  { x: 270, y: 490 },
  { x: 285, y: 610 },
  { x: 350, y: 700 },
  { x: 420, y: 750 },
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

export function nearestTrackProgress(x: number, y: number): { progress: number; distance: number } {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestAlong = 0;

  for (const s of segments) {
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - s.a.x) * dx + (y - s.a.y) * dy) / lenSq));
    const px = s.a.x + dx * t;
    const py = s.a.y + dy * t;
    const distance = Math.hypot(x - px, y - py);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestAlong = s.start + s.length * t;
    }
  }

  return { progress: bestAlong / TRACK_LENGTH, distance: bestDistance };
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
