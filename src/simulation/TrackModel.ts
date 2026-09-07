export interface TrackPoint { x: number; y: number }

// Clockwise racing line. Point zero is the start/finish reference.
export const RACING_LINE: readonly TrackPoint[] = [
  { x: 520, y: 753 }, { x: 760, y: 753 }, { x: 1000, y: 748 },
  { x: 1175, y: 708 }, { x: 1260, y: 610 }, { x: 1280, y: 490 },
  { x: 1245, y: 370 }, { x: 1140, y: 285 }, { x: 970, y: 247 },
  { x: 760, y: 247 }, { x: 545, y: 252 }, { x: 405, y: 305 },
  { x: 330, y: 405 }, { x: 320, y: 525 }, { x: 365, y: 640 },
  { x: 435, y: 715 },
];

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
  const segment = segments.find((s) => distance <= s.start + s.length) ?? segments[segments.length - 1];
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
