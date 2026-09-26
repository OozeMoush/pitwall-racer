export interface TrackPoint { x: number; y: number }

export type TrackId =
  | 'pitwall-gp'
  | 'velocity-park'
  | 'switchback-ring'
  | 'sakura-esses'
  | 'harbor-chicane'
  | 'serra-circuit'
  | 'baku-street';

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

// Rhythm circuit inspired by the idea of Suzuka-style linked esses: repeated
// commitment corners feed into a hairpin and one long, fast loaded arc.
const SAKURA_ESSES_SOURCE: readonly TrackPoint[] = [
  { x: 520, y: 915 }, { x: 900, y: 930 }, { x: 1300, y: 910 }, { x: 1650, y: 850 },
  { x: 1900, y: 740 }, { x: 2000, y: 610 }, { x: 1950, y: 500 }, { x: 1800, y: 430 },
  { x: 1620, y: 470 }, { x: 1470, y: 390 }, { x: 1320, y: 475 }, { x: 1170, y: 395 },
  { x: 1020, y: 480 }, { x: 870, y: 405 }, { x: 720, y: 350 }, { x: 560, y: 370 },
  { x: 430, y: 450 }, { x: 350, y: 570 }, { x: 350, y: 700 }, { x: 430, y: 815 },
];

// Dense street-style circuit: many braking references, 90-degree direction
// changes and a real chicane. The final array is reversed so this is the first
// clockwise-feeling layout in the initial track set.
const HARBOR_CHICANE_SOURCE: readonly TrackPoint[] = [
  { x: 510, y: 905 }, { x: 900, y: 930 }, { x: 1320, y: 925 }, { x: 1700, y: 900 },
  { x: 1980, y: 830 }, { x: 2110, y: 720 }, { x: 2060, y: 620 }, { x: 1870, y: 600 },
  { x: 1720, y: 540 }, { x: 1770, y: 455 }, { x: 1960, y: 405 }, { x: 2050, y: 310 },
  { x: 1950, y: 235 }, { x: 1730, y: 220 }, { x: 1510, y: 270 }, { x: 1380, y: 355 },
  { x: 1200, y: 345 }, { x: 1080, y: 265 }, { x: 900, y: 225 }, { x: 715, y: 255 },
  { x: 605, y: 345 }, { x: 630, y: 450 }, { x: 760, y: 525 }, { x: 705, y: 615 },
  { x: 530, y: 650 }, { x: 395, y: 735 }, { x: 350, y: 835 },
];

// Short-lap attack circuit inspired by Interlagos-style compactness: corner
// exits matter because nearly every short straight immediately feeds the next
// braking zone.
const SERRA_CIRCUIT_SOURCE: readonly TrackPoint[] = [
  { x: 550, y: 910 }, { x: 950, y: 930 }, { x: 1370, y: 910 }, { x: 1690, y: 845 },
  { x: 1870, y: 745 }, { x: 1900, y: 640 }, { x: 1810, y: 565 }, { x: 1640, y: 555 },
  { x: 1480, y: 610 }, { x: 1340, y: 695 }, { x: 1160, y: 720 }, { x: 1000, y: 665 },
  { x: 960, y: 565 }, { x: 1060, y: 475 }, { x: 1190, y: 395 }, { x: 1160, y: 300 },
  { x: 1010, y: 235 }, { x: 820, y: 225 }, { x: 640, y: 270 }, { x: 485, y: 355 },
  { x: 365, y: 470 }, { x: 310, y: 595 }, { x: 350, y: 720 }, { x: 445, y: 825 },
];

// Baku-inspired street layout. The official circuit is a 6.003 km, 20-turn
// street track; this miniature preserves the defining rhythm rather than
// literal scale: huge waterfront straight, square city blocks, a tight castle
// sequence, then the fast descent back toward the sea.
const BAKU_STREET_SOURCE: readonly TrackPoint[] = [
  { x: 587, y: 884 }, { x: 465, y: 933 }, { x: 343, y: 982 }, { x: 216, y: 974 },
  { x: 138, y: 889 }, { x: 228, y: 800 }, { x: 343, y: 736 }, { x: 463, y: 682 },
  { x: 584, y: 632 }, { x: 708, y: 588 }, { x: 836, y: 561 }, { x: 963, y: 583 },
  { x: 1094, y: 569 }, { x: 1222, y: 541 }, { x: 1351, y: 535 }, { x: 1478, y: 503 },
  { x: 1602, y: 461 }, { x: 1638, y: 374 }, { x: 1660, y: 287 }, { x: 1706, y: 200 },
  { x: 1827, y: 148 }, { x: 1954, y: 116 }, { x: 2085, y: 115 }, { x: 2214, y: 139 },
  { x: 2332, y: 194 }, { x: 2390, y: 307 }, { x: 2339, y: 418 }, { x: 2212, y: 449 },
  { x: 2082, y: 463 }, { x: 1950, y: 467 }, { x: 1820, y: 451 }, { x: 1690, y: 462 },
  { x: 1564, y: 498 }, { x: 1440, y: 541 }, { x: 1317, y: 587 }, { x: 1196, y: 637 },
  { x: 1074, y: 688 }, { x: 953, y: 738 }, { x: 831, y: 788 }, { x: 709, y: 836 },
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
const SAKURA_ESSES = miniature(SAKURA_ESSES_SOURCE);
const HARBOR_CHICANE = miniature([...HARBOR_CHICANE_SOURCE].reverse());
const SERRA_CIRCUIT = miniature(SERRA_CIRCUIT_SOURCE);
const BAKU_STREET = miniature(BAKU_STREET_SOURCE);

export const TRACKS: readonly TrackDefinition[] = [
  { id: 'pitwall-gp', name: 'PITWALL GP', subtitle: 'MINIATURE · BALANCED · FAST LAP', controls: PITWALL_GP },
  { id: 'velocity-park', name: 'VELOCITY PARK', subtitle: 'MINIATURE · HIGH SPEED · HEAVY BRAKING', controls: VELOCITY_PARK },
  { id: 'switchback-ring', name: 'SWITCHBACK RING', subtitle: 'MINIATURE · TECHNICAL · TYRE TEST', controls: SWITCHBACK_RING },
  { id: 'sakura-esses', name: 'SAKURA ESSES', subtitle: 'RHYTHM · LINKED ESSES · HAIRPIN', controls: SAKURA_ESSES },
  { id: 'harbor-chicane', name: 'HARBOR CHICANE', subtitle: 'CLOCKWISE · STREET · BRAKE & ROTATE', controls: HARBOR_CHICANE },
  { id: 'serra-circuit', name: 'SERRA CIRCUIT', subtitle: 'SHORT LAP · MIXED · EXIT SPEED', controls: SERRA_CIRCUIT },
  { id: 'baku-street', name: 'BAKU STREET', subtitle: 'AZERBAIJAN-STYLE · CITY WALLS · LONG STRAIGHT', controls: BAKU_STREET },
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
// target points at the wrong road and it never recovers. Do not continuously
// bias every projection, though: that can make a perfectly healthy car cling to
// an old hairpin segment. First accept the geometric nearest point when its
// progress is a plausible 120 Hz continuation; invoke the continuity tie-break
// only when nearest-point projection makes an implausible jump around the lap.
export function projectTrackNear(
  x: number,
  y: number,
  referenceProgress: number,
  continuityWeight = 0.85,
): TrackProjection {
  const nearest = projectTrackInternal(x, y);
  const jumpMetres = circularProgressDistance(nearest.progress, referenceProgress) * TRACK_LENGTH;
  const plausibleStepMetres = Math.max(5.5, raceScaleDistance(13));
  if (jumpMetres <= plausibleStepMetres) return nearest;

  const continuous = projectTrackInternal(
    x,
    y,
    referenceProgress,
    continuityWeight,
  );

  // Continuity is only a tie-breaker between nearby pieces of circuit. Once
  // the old branch is clearly much farther from the physical car, clinging to
  // it creates impossible 50-100 m lane errors and traps AI in permanent
  // runoff recovery. Snap back to the actual nearest road in that case.
  if (nearest.distance + 7 < continuous.distance) return nearest;
  return continuous;
}

export function nearestTrackProgress(x: number, y: number): { progress: number; distance: number } {
  const projection = projectTrack(x, y);
  return { progress: projection.progress, distance: projection.distance };
}

/**
 * Detect a real forward lap wrap without relying on a narrow hard-coded
 * 0.88→0.12 window. A normal 120 Hz step is tiny; crossing the start line is
 * the only legitimate large negative progress jump once the ordered lap
 * checkpoints have been visited.
 */
export function crossedStartLine(previousProgress: number, currentProgress: number): boolean {
  const previous = ((previousProgress % 1) + 1) % 1;
  const current = ((currentProgress % 1) + 1) % 1;
  return previous - current > 0.5;
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
