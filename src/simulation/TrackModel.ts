export interface TrackPoint { x: number; y: number }

export type TrackId = 'pitwall-gp' | 'velocity-park' | 'switchback-ring';

export interface TrackDefinition {
  id: TrackId;
  name: string;
  subtitle: string;
  controls: readonly TrackPoint[];
}

export interface TrackProjection {
  progress: number;
  distance: number;
  laneOffset: number;
  heading: number;
  x: number;
  y: number;
}

// Pitwall Racer is intentionally a miniature racing game rather than a
// kilometre-for-kilometre circuit simulator. Shortening the physical circuit
// keeps 40-60 lap races in a compact play session and makes trackside objects
// sweep past quickly without inflating the speedometer into nonsense.
export const MINIATURE_TRACK_SCALE = 0.42;
export const TRACK_CENTRE_X = 1110;
export const TRACK_CENTRE_Y = 600;

export function raceScaleDistance(metres: number): number {
  return metres * MINIATURE_TRACK_SCALE;
}

const PITWALL_GP_SOURCE: readonly TrackPoint[] = [
  { x: 560, y: 930 }, { x: 1080, y: 930 }, { x: 1580, y: 930 }, { x: 1940, y: 920 },
  { x: 2110, y: 865 }, { x: 2180, y: 750 }, { x: 2150, y: 625 }, { x: 2040, y: 550 },
  { x: 1840, y: 520 }, { x: 1640, y: 520 }, { x: 1480, y: 470 }, { x: 1370, y: 375 },
  { x: 1395, y: 270 }, { x: 1280, y: 205 }, { x: 1110, y: 220 }, { x: 950, y: 300 },
  { x: 800, y: 345 }, { x: 675, y: 300 }, { x: 560, y: 220 }, { x: 410, y: 225 },
  { x: 285, y: 315 }, { x: 220, y: 445 }, { x: 245, y: 565 }, { x: 345, y: 620 },
  { x: 355, y: 675 }, { x: 305, y: 730 }, { x: 290, y: 790 }, { x: 345, y: 850 },
  { x: 430, y: 910 },
];

// High-speed circuit: long straights, broad sweepers and one heavy braking complex.
const VELOCITY_PARK_SOURCE: readonly TrackPoint[] = [
  { x: 520, y: 900 }, { x: 1020, y: 930 }, { x: 1580, y: 925 }, { x: 2040, y: 880 },
  { x: 2220, y: 780 }, { x: 2240, y: 650 }, { x: 2160, y: 545 }, { x: 1980, y: 485 },
  { x: 1680, y: 470 }, { x: 1430, y: 500 }, { x: 1260, y: 455 }, { x: 1160, y: 365 },
  { x: 1070, y: 255 }, { x: 890, y: 205 }, { x: 660, y: 220 }, { x: 430, y: 300 },
  { x: 275, y: 420 }, { x: 235, y: 575 }, { x: 295, y: 725 }, { x: 390, y: 820 },
];

// Technical circuit: repeated direction changes and short straights reward braking and tyre grip.
const SWITCHBACK_RING_SOURCE: readonly TrackPoint[] = [
  { x: 560, y: 910 }, { x: 870, y: 930 }, { x: 1160, y: 895 }, { x: 1370, y: 805 },
  { x: 1450, y: 690 }, { x: 1375, y: 590 }, { x: 1190, y: 555 }, { x: 1040, y: 620 },
  { x: 1000, y: 745 }, { x: 855, y: 800 }, { x: 700, y: 740 }, { x: 680, y: 610 },
  { x: 805, y: 530 }, { x: 1010, y: 495 }, { x: 1130, y: 410 }, { x: 1110, y: 300 },
  { x: 955, y: 225 }, { x: 735, y: 215 }, { x: 530, y: 265 }, { x: 375, y: 365 },
  { x: 285, y: 500 }, { x: 295, y: 650 }, { x: 385, y: 780 }, { x: 470, y: 865 },
];

function miniature(points: readonly TrackPoint[]): readonly TrackPoint[] {
  return points.map((point) => ({
    x: TRACK_CENTRE_X + (point.x - TRACK_CENTRE_X) * MINIATURE_TRACK_SCALE,
    y: TRACK_CENTRE_Y + (point.y - TRACK_CENTRE_Y) * MINIATURE_TRACK_SCALE,
  }));
}

const PITWALL_GP = miniature(PITWALL_GP_SOURCE);
const VELOCITY_PARK = miniature(VELOCITY_PARK_SOURCE);
const SWITCHBACK_RING = miniature(SWITCHBACK_RING_SOURCE);

export const TRACKS: readonly TrackDefinition[] = [
  { id: 'pitwall-gp', name: 'PITWALL GP', subtitle: 'MINIATURE · BALANCED · FAST LAP', controls: PITWALL_GP },
  { id: 'velocity-park', name: 'VELOCITY PARK', subtitle: 'MINIATURE · HIGH SPEED · HEAVY BRAKING', controls: VELOCITY_PARK },
  { id: 'switchback-ring', name: 'SWITCHBACK RING', subtitle: 'MINIATURE · TECHNICAL · TYRE TEST', controls: SWITCHBACK_RING },
] as const;

const SAMPLES_PER_CONTROL = 28;

interface Segment { a: TrackPoint; b: TrackPoint; length: number; start: number }

let activeTrackId: TrackId = 'pitwall-gp';
export let TRACK_CONTROLS: readonly TrackPoint[] = PITWALL_GP;
export let RACING_LINE: readonly TrackPoint[] = [];
export let TRACK_LENGTH = 0;
let segments: Segment[] = [];

rebuildTrack(PITWALL_GP);

export function setActiveTrack(id: TrackId): void {
  const definition = TRACKS.find((track) => track.id === id);
  if (!definition) throw new Error(`Unknown track: ${id}`);
  activeTrackId = id;
  TRACK_CONTROLS = definition.controls;
  rebuildTrack(definition.controls);
}

export function getActiveTrack(): TrackDefinition {
  return TRACKS.find((track) => track.id === activeTrackId) ?? TRACKS[0];
}

export function getTrackDefinition(id: TrackId): TrackDefinition {
  return TRACKS.find((track) => track.id === id) ?? TRACKS[0];
}

export function sampleTrack(progress: number, laneOffset = 0): TrackPoint & { heading: number } {
  const p = ((progress % 1) + 1) % 1;
  const distance = p * TRACK_LENGTH;
  const segment = segmentAtDistance(distance);
  const t = Math.max(0, Math.min(1, (distance - segment.start) / Math.max(0.0001, segment.length)));
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
  return projectTrackInternal(x, y);
}

// On a miniature circuit, two unrelated pieces of track can be only a few car
// widths apart. Pure nearest-point projection can then snap an off-line AI from
// its current corner onto the neighbouring section, after which its steering
// target points at the wrong road and it never recovers. For cars whose previous
// progress is known, prefer spatially-near candidates that are also continuous
// with that progress. The returned distance is still the real geometric track
// distance, so grass/runoff physics remain honest.
export function projectTrackNear(
  x: number,
  y: number,
  referenceProgress: number,
  continuityWeight = 0.85,
): TrackProjection {
  return projectTrackInternal(x, y, referenceProgress, continuityWeight);
}

export function nearestTrackProgress(x: number, y: number): { progress: number; distance: number } {
  const projection = projectTrack(x, y);
  return { progress: projection.progress, distance: projection.distance };
}

function projectTrackInternal(
  x: number,
  y: number,
  referenceProgress?: number,
  continuityWeight = 0,
): TrackProjection {
  let bestScore = Number.POSITIVE_INFINITY;
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
    const along = s.start + s.length * t;
    const progress = along / TRACK_LENGTH;
    const progressPenalty = referenceProgress === undefined
      ? 0
      : circularProgressDistance(progress, referenceProgress) * TRACK_LENGTH * continuityWeight;
    const score = distance + progressPenalty;

    if (score < bestScore) {
      const heading = Math.atan2(dy, dx);
      const nx = -Math.sin(heading);
      const ny = Math.cos(heading);
      bestScore = score;
      bestDistance = distance;
      bestAlong = along;
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

function circularProgressDistance(a: number, b: number): number {
  const delta = Math.abs((((a - b) % 1) + 1) % 1);
  return Math.min(delta, 1 - delta);
}

function rebuildTrack(controls: readonly TrackPoint[]): void {
  RACING_LINE = buildClosedCatmullRom(controls, SAMPLES_PER_CONTROL);
  const nextSegments: Segment[] = [];
  let total = 0;
  for (let i = 0; i < RACING_LINE.length; i++) {
    const a = RACING_LINE[i];
    const b = RACING_LINE[(i + 1) % RACING_LINE.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    nextSegments.push({ a, b, length, start: total });
    total += length;
  }
  segments = nextSegments;
  TRACK_LENGTH = total;
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
