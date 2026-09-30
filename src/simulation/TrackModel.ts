export interface TrackPoint { x: number; y: number }

export const EDITOR_TRACK_ID = 'editor-custom' as const;

export type TrackId =
  | 'pitwall-gp'
  | 'velocity-park'
  | 'switchback-ring'
  | 'sakura-esses'
  | 'harbor-chicane'
  | 'serra-circuit'
  | 'baku-street'
  | typeof EDITOR_TRACK_ID;

export interface PitLaneDefinition {
  /** Lap progress where a committed pit entry begins. */
  entryProgress: number;
  /** Optional explicit exit progress; legacy tracks derive it from lane length. */
  exitProgress?: number;
  /** Physical route length, independent from whole-circuit length. */
  lengthMetres: number;
  /** Maximum centre-line offset from the racing surface. */
  laneOffset: number;
}

export interface GridDefinition {
  frontGapMetres: number;
  longitudinalStepMetres: number;
  laneOffset: number;
}

interface TrackStretchDefinition {
  extensionMetres: number;
  outStart: number;
  outEnd: number;
  backStart: number;
  backEnd: number;
  xDirection?: number;
  yDirection?: number;
}

export interface TrackDefinition {
  id: TrackId;
  name: string;
  subtitle: string;
  controls: readonly TrackPoint[];
  /** Optional authored road half-width at each control point. */
  roadHalfWidths?: readonly number[];
  geometry?: 'smooth' | 'street' | 'pitwall-grand-prix';
  stretch?: TrackStretchDefinition;
  referenceLaneMode?: 'optimized' | 'centerline';
  /** Metre conversion for gameplay lookaheads; 1 for race-scale layouts. */
  distanceScale?: number;
  /** Current representative clean-lap time used to turn race duration into laps. */
  referenceLapSeconds?: number;
  /** Timing split positions measured as lap progress. */
  sectorBoundaries?: readonly [number, number];
  pitLane?: PitLaneDefinition;
  grid?: GridDefinition;
  editorAuthored?: boolean;
}

export const DEFAULT_PIT_LANE_DEFINITION: PitLaneDefinition = {
  entryProgress: 0.91,
  lengthMetres: 342,
  laneOffset: 34,
};

export interface TrackProjection {
  progress: number;
  distance: number;
  laneOffset: number;
  heading: number;
  x: number;
  y: number;
}

// Some fictional circuits still use the original miniature scale while
// race-scale layouts use real metre lookaheads.
// Gameplay distances therefore follow the active circuit instead of silently
// shrinking every real-world metre by 0.42.
export const MINIATURE_TRACK_SCALE = 0.42;
export let TRACK_DISTANCE_SCALE = 1;
export const TRACK_CENTRE_X = 1110;
export const TRACK_CENTRE_Y = 600;

export function raceScaleDistance(metres: number): number {
  return metres * TRACK_DISTANCE_SCALE;
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

// Baku City Circuit silhouette, simplified from the MIT-licensed
// bacinger/f1-circuits az-2016 GeoJSON and transformed into Pitwall's source
// coordinate space. Unlike the old invented loop, this keeps the real circuit's
// long flat-out waterfront run, city-block braking zones, castle approach and
// fast return sequence. The street-specific interpolator below rounds only the
// immediate corner vertices instead of Catmull-Rom overshooting across nearby
// streets.
const BAKU_STREET_SOURCE: readonly TrackPoint[] = [
  { x: 1246, y: 578 }, { x: 2255, y: 143 }, { x: 2268, y: 119 }, { x: 2236, y: 31 },
  { x: 2146, y: -159 }, { x: 2130, y: -165 }, { x: 1823, y: -44 }, { x: 1393, y: 151 },
  { x: 1380, y: 165 }, { x: 1380, y: 183 }, { x: 1445, y: 365 }, { x: 1435, y: 377 },
  { x: 1258, y: 465 }, { x: 1172, y: 521 }, { x: 1166, y: 528 }, { x: 1182, y: 579 },
  { x: 898, y: 806 }, { x: 884, y: 806 }, { x: 873, y: 793 }, { x: 821, y: 640 },
  { x: 774, y: 620 }, { x: 726, y: 614 }, { x: 709, y: 568 }, { x: 696, y: 556 },
  { x: 601, y: 584 }, { x: 469, y: 649 }, { x: 364, y: 715 }, { x: 338, y: 759 },
  { x: 293, y: 924 }, { x: 311, y: 1138 }, { x: 322, y: 1150 }, { x: 500, y: 1244 },
  { x: 578, y: 1276 }, { x: 611, y: 1276 }, { x: 632, y: 1258 }, { x: 713, y: 1117 },
  { x: 879, y: 959 }, { x: 899, y: 850 }, { x: 916, y: 814 }, { x: 1151, y: 631 },
];

function scaleAroundCentre(
  points: readonly TrackPoint[],
  scale: number,
): readonly TrackPoint[] {
  return points.map((point) => ({
    x: TRACK_CENTRE_X + (point.x - TRACK_CENTRE_X) * scale,
    y: TRACK_CENTRE_Y + (point.y - TRACK_CENTRE_Y) * scale,
  }));
}

function miniature(points: readonly TrackPoint[]): readonly TrackPoint[] {
  return scaleAroundCentre(points, MINIATURE_TRACK_SCALE);
}

const PITWALL_GP = miniature(PITWALL_GP_SOURCE);
const VELOCITY_PARK = miniature(VELOCITY_PARK_SOURCE);
const SWITCHBACK_RING = miniature(SWITCHBACK_RING_SOURCE);
const SAKURA_ESSES = miniature(SAKURA_ESSES_SOURCE);
const HARBOR_CHICANE = miniature([...HARBOR_CHICANE_SOURCE].reverse());
const SERRA_CIRCUIT = miniature(SERRA_CIRCUIT_SOURCE);
const BAKU_RACE_SCALE = 1.055;
const BAKU_STREET = scaleAroundCentre(BAKU_STREET_SOURCE, BAKU_RACE_SCALE);

export const TRACKS: TrackDefinition[] = [
  {
    id: 'pitwall-gp',
    name: 'PITWALL GP',
    subtitle: 'GRAND PRIX · HIGH-SPEED FLOW · TECHNICAL CORE',
    controls: PITWALL_GP,
    geometry: 'pitwall-grand-prix',
    referenceLaneMode: 'centerline',
    distanceScale: 1,
    referenceLapSeconds: 90,
    pitLane: { entryProgress: 0.985, lengthMetres: 480, laneOffset: 34 },
  },
  {
    id: 'velocity-park',
    name: 'VELOCITY PARK',
    subtitle: 'GRAND PRIX · HIGH SPEED · HEAVY BRAKING',
    controls: VELOCITY_PARK,
    stretch: {
      extensionMetres: 3200,
      outStart: 0.02,
      outEnd: 0.28,
      backStart: 0.46,
      backEnd: 0.58,
    },
    distanceScale: 1,
    referenceLapSeconds: 90,
    pitLane: { entryProgress: 0.985, lengthMetres: 480, laneOffset: 34 },
  },
  {
    id: 'switchback-ring',
    name: 'SWITCHBACK RING',
    subtitle: 'GRAND PRIX · TECHNICAL · TYRE TEST',
    controls: SWITCHBACK_RING,
    stretch: {
      extensionMetres: 3000,
      outStart: 0.02,
      outEnd: 0.20,
      backStart: 0.66,
      backEnd: 0.82,
    },
    distanceScale: 1,
    referenceLapSeconds: 90,
    pitLane: { entryProgress: 0.985, lengthMetres: 480, laneOffset: 34 },
  },
  {
    id: 'sakura-esses',
    name: 'SAKURA ESSES',
    subtitle: 'GRAND PRIX · LINKED ESSES · HAIRPIN',
    controls: SAKURA_ESSES,
    stretch: {
      extensionMetres: 3000,
      outStart: 0.02,
      outEnd: 0.30,
      // The linked esses all travel broadly westward. Return the added X
      // distance gradually across that whole sequence instead of forcing the
      // entire 3 km correction into the short final arc, which created an
      // artificial low-speed kink and pit-path discontinuity.
      backStart: 0.47,
      backEnd: 0.86,
    },
    distanceScale: 1,
    referenceLapSeconds: 90,
    pitLane: { entryProgress: 0.985, lengthMetres: 480, laneOffset: 34 },
  },
  {
    id: 'harbor-chicane',
    name: 'HARBOR CHICANE',
    subtitle: 'CLOCKWISE · STREET · BRAKE & ROTATE',
    controls: HARBOR_CHICANE,
    stretch: {
      extensionMetres: 2800,
      outStart: 0.18,
      outEnd: 0.44,
      backStart: 0.675,
      backEnd: 0.966,
    },
    distanceScale: 1,
    referenceLapSeconds: 90,
    pitLane: { entryProgress: 0.985, lengthMetres: 480, laneOffset: 34 },
  },
  { id: 'serra-circuit', name: 'SERRA CIRCUIT', subtitle: 'SHORT LAP · MIXED · EXIT SPEED', controls: SERRA_CIRCUIT, referenceLapSeconds: 23.119, pitLane: DEFAULT_PIT_LANE_DEFINITION },
  {
    id: 'baku-street',
    name: 'BAKU STREET',
    subtitle: 'BAKU CITY CIRCUIT · CASTLE · LONG STRAIGHT',
    controls: BAKU_STREET,
    geometry: 'street',
    distanceScale: 1,
    referenceLapSeconds: 90,
    pitLane: { entryProgress: 0.985, lengthMetres: 480, laneOffset: 34 },
  },
];

const SAMPLES_PER_CONTROL = 28;

const PITWALL_GP_STRAIGHT_EXTENSION = 3000;
const PITWALL_GP_STRETCH_OUT_START = 0.05;
const PITWALL_GP_STRETCH_OUT_END = 0.25;
const PITWALL_GP_STRETCH_BACK_START = 0.42;
const PITWALL_GP_STRETCH_BACK_END = 0.50;


interface Segment { a: TrackPoint; b: TrackPoint; length: number; start: number }

let activeTrackId: TrackId = 'pitwall-gp';
export let TRACK_CONTROLS: readonly TrackPoint[] = PITWALL_GP;
export let RACING_LINE: readonly TrackPoint[] = [];
export let TRACK_LENGTH = 0;
let segments: Segment[] = [];

rebuildTrack(TRACKS[0]);

export function setActiveTrack(id: TrackId): void {
  const definition = TRACKS.find((track) => track.id === id);
  if (!definition) throw new Error(`Unknown track: ${id}`);
  activeTrackId = id;
  TRACK_DISTANCE_SCALE = definition.distanceScale ?? MINIATURE_TRACK_SCALE;
  TRACK_CONTROLS = definition.controls;
  rebuildTrack(definition);
}

export function getActiveTrack(): TrackDefinition {
  return TRACKS.find((track) => track.id === activeTrackId) ?? TRACKS[0];
}

export function getTrackDefinition(id: TrackId): TrackDefinition {
  return TRACKS.find((track) => track.id === id) ?? TRACKS[0];
}

export function registerEditorTrack(definition: TrackDefinition): void {
  if (definition.id !== EDITOR_TRACK_ID) {
    throw new Error(`Editor track must use id ${EDITOR_TRACK_ID}`);
  }
  const index = TRACKS.findIndex((track) => track.id === EDITOR_TRACK_ID);
  if (index >= 0) TRACKS[index] = definition;
  else TRACKS.push(definition);
  if (activeTrackId === EDITOR_TRACK_ID) setActiveTrack(EDITOR_TRACK_ID);
}

export function sectorBoundariesFor(
  id: TrackId,
): readonly [number, number] {
  const boundaries = getTrackDefinition(id).sectorBoundaries;
  if (!boundaries) return [1 / 3, 2 / 3];
  const first = Math.max(0.05, Math.min(0.9, boundaries[0]));
  const second = Math.max(first + 0.05, Math.min(0.95, boundaries[1]));
  return [first, second];
}

export function trackCentreline(id: TrackId): readonly TrackPoint[] {
  const definition = getTrackDefinition(id);
  return buildTrackCentreline(definition);
}

/**
 * Stable fingerprint of the generated centreline, not a manually maintained
 * version number. Any control-point, interpolation or stretch change that
 * moves the playable road therefore invalidates geometry-derived persistence
 * automatically.
 */
export function trackGeometryFingerprint(points: readonly TrackPoint[]): string {
  let hash = 0x811c9dc5;
  const mixInt32 = (value: number) => {
    const integer = value | 0;
    for (let byte = 0; byte < 4; byte++) {
      hash ^= (integer >>> (byte * 8)) & 0xff;
      hash = Math.imul(hash, 0x01000193);
    }
  };

  mixInt32(points.length);
  for (const point of points) {
    // Millimetre precision is far tighter than meaningful circuit edits while
    // keeping the fingerprint deterministic across JSON/storage round trips.
    mixInt32(Math.round(point.x * 1000));
    mixInt32(Math.round(point.y * 1000));
  }

  return `g1-${(hash >>> 0).toString(16).padStart(8, '0')}-${points.length}`;
}

export function trackGeometryRevision(id: TrackId): string {
  return trackGeometryFingerprint(trackCentreline(id));
}

export function trackLengthFor(id: TrackId): number {
  const points = trackCentreline(id);
  let total = 0;
  for (let index = 0; index < points.length; index++) {
    total += Math.hypot(
      points[(index + 1) % points.length].x - points[index].x,
      points[(index + 1) % points.length].y - points[index].y,
    );
  }
  return total;
}

export function samplesForDistance(
  distanceMetres: number,
  spacingMetres: number,
  minimum: number,
  maximum = 2400,
): number {
  const spacing = Math.max(0.5, spacingMetres);
  return Math.max(
    minimum,
    Math.min(maximum, Math.ceil(Math.max(0, distanceMetres) / spacing)),
  );
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

function rebuildTrack(definition: TrackDefinition): void {
  RACING_LINE = buildTrackCentreline(definition);
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

function buildTrackCentreline(definition: TrackDefinition): readonly TrackPoint[] {
  if (definition.geometry === 'street') {
    return buildClosedRoundedStreet(definition.controls, SAMPLES_PER_CONTROL);
  }
  const smooth = buildClosedCatmullRom(definition.controls, SAMPLES_PER_CONTROL);
  const geometry = definition.geometry === 'pitwall-grand-prix'
    ? stretchPitwallGrandPrix(smooth)
    : smooth;
  return definition.stretch
    ? stretchTrackSections(geometry, definition.stretch)
    : geometry;
}

function stretchTrackSections(
  base: readonly TrackPoint[],
  definition: TrackStretchDefinition,
): TrackPoint[] {
  if (base.length < 2) return base.map((point) => ({ ...point }));

  const segmentLengths = base.map((point, index) => {
    const next = base[(index + 1) % base.length];
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
  const baseLength = segmentLengths.reduce((sum, value) => sum + value, 0);
  const directionLength = Math.hypot(
    definition.xDirection ?? 1,
    definition.yDirection ?? 0,
  );
  const nx = (definition.xDirection ?? 1) / Math.max(0.0001, directionLength);
  const ny = (definition.yDirection ?? 0) / Math.max(0.0001, directionLength);
  let along = 0;

  return base.map((point, index) => {
    const progress = baseLength <= 0 ? 0 : along / baseLength;
    const weight = stretchWeight(progress, definition);
    along += segmentLengths[index];
    return {
      x: point.x + nx * definition.extensionMetres * weight,
      y: point.y + ny * definition.extensionMetres * weight,
    };
  });
}

function stretchWeight(
  progress: number,
  definition: TrackStretchDefinition,
): number {
  if (progress <= definition.outStart) return 0;
  if (progress < definition.outEnd) {
    return smoothstep01(
      (progress - definition.outStart)
      / Math.max(0.0001, definition.outEnd - definition.outStart),
    );
  }
  if (progress <= definition.backStart) return 1;
  if (progress < definition.backEnd) {
    return 1 - smoothstep01(
      (progress - definition.backStart)
      / Math.max(0.0001, definition.backEnd - definition.backStart),
    );
  }
  return 0;
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

/**
 * Pitwall GP 2.0 preserves the existing corner geometry and adds distance by
 * stretching the two naturally straight portions around the opening complex.
 *
 * The old lap is first generated unchanged. A smooth X translation then grows
 * along the opening straight, stays constant through the first corner complex,
 * and is removed along the following westbound straight. Everything after
 * 50% of the old lap therefore retains its original coordinates exactly.
 */
function stretchPitwallGrandPrix(base: readonly TrackPoint[]): TrackPoint[] {
  if (base.length < 2) return base.map((point) => ({ ...point }));

  const segmentLengths = base.map((point, index) => {
    const next = base[(index + 1) % base.length];
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
  const baseLength = segmentLengths.reduce((sum, value) => sum + value, 0);
  let along = 0;

  return base.map((point, index) => {
    const progress = baseLength <= 0 ? 0 : along / baseLength;
    const weight = pitwallStretchWeight(progress);
    along += segmentLengths[index];
    return {
      x: point.x + PITWALL_GP_STRAIGHT_EXTENSION * weight,
      y: point.y,
    };
  });
}

function pitwallStretchWeight(progress: number): number {
  if (progress <= PITWALL_GP_STRETCH_OUT_START) return 0;
  if (progress < PITWALL_GP_STRETCH_OUT_END) {
    return smoothstep01(
      (progress - PITWALL_GP_STRETCH_OUT_START)
      / (PITWALL_GP_STRETCH_OUT_END - PITWALL_GP_STRETCH_OUT_START),
    );
  }
  if (progress <= PITWALL_GP_STRETCH_BACK_START) return 1;
  if (progress < PITWALL_GP_STRETCH_BACK_END) {
    return 1 - smoothstep01(
      (progress - PITWALL_GP_STRETCH_BACK_START)
      / (PITWALL_GP_STRETCH_BACK_END - PITWALL_GP_STRETCH_BACK_START),
    );
  }
  return 0;
}

function smoothstep01(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function buildClosedRoundedStreet(
  points: readonly TrackPoint[],
  samplesPerControl: number,
): TrackPoint[] {
  // Real street-circuit traces contain clusters of survey points around the
  // same physical corner. Treating every one as a separate vertex creates
  // 70-90 degree heading snaps after miniature scaling. Collapse only very
  // close neighbours first; the major Baku corners remain distinct.
  const streetPoints = mergeNearbyStreetControls(points, 10);
  const count = streetPoints.length;
  const entries: TrackPoint[] = [];
  const exits: TrackPoint[] = [];
  const cornerRadius = 28;

  for (let i = 0; i < count; i++) {
    const previous = streetPoints[(i - 1 + count) % count];
    const current = streetPoints[i];
    const next = streetPoints[(i + 1) % count];
    const inX = previous.x - current.x;
    const inY = previous.y - current.y;
    const outX = next.x - current.x;
    const outY = next.y - current.y;
    const inLength = Math.hypot(inX, inY);
    const outLength = Math.hypot(outX, outY);
    if (inLength < 0.001 || outLength < 0.001) {
      entries.push({ ...current });
      exits.push({ ...current });
      continue;
    }

    const cut = Math.min(cornerRadius, inLength * 0.35, outLength * 0.35);
    entries.push({
      x: current.x + inX / inLength * cut,
      y: current.y + inY / inLength * cut,
    });
    exits.push({
      x: current.x + outX / outLength * cut,
      y: current.y + outY / outLength * cut,
    });
  }

  const result: TrackPoint[] = [];
  const curveSamples = Math.max(5, Math.round(samplesPerControl * 0.40));
  const straightSamples = Math.max(3, samplesPerControl - curveSamples);

  for (let i = 0; i < count; i++) {
    const entry = entries[i];
    const corner = streetPoints[i];
    const exit = exits[i];
    const nextEntry = entries[(i + 1) % count];

    for (let sample = 0; sample < curveSamples; sample++) {
      const t = sample / curveSamples;
      const oneMinusT = 1 - t;
      result.push({
        x: oneMinusT * oneMinusT * entry.x
          + 2 * oneMinusT * t * corner.x
          + t * t * exit.x,
        y: oneMinusT * oneMinusT * entry.y
          + 2 * oneMinusT * t * corner.y
          + t * t * exit.y,
      });
    }

    for (let sample = 0; sample < straightSamples; sample++) {
      const t = sample / straightSamples;
      result.push({
        x: exit.x + (nextEntry.x - exit.x) * t,
        y: exit.y + (nextEntry.y - exit.y) * t,
      });
    }
  }

  return result;
}

function mergeNearbyStreetControls(
  points: readonly TrackPoint[],
  minimumSpacing: number,
): TrackPoint[] {
  if (points.length <= 3) return points.map((point) => ({ ...point }));

  const result: TrackPoint[] = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (
      !previous
      || Math.hypot(point.x - previous.x, point.y - previous.y) >= minimumSpacing
    ) {
      result.push({ ...point });
    }
  }

  if (
    result.length > 3
    && Math.hypot(
      result[0].x - result[result.length - 1].x,
      result[0].y - result[result.length - 1].y,
    ) < minimumSpacing
  ) {
    result.pop();
  }
  return result;
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
