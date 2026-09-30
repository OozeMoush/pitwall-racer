import type { RacingLineAsset } from './RacingLineAsset';
import { saveEditorRacingLine, type RacingLineSelectionStorage } from './RacingLineSelectionStore';
import {
  EDITOR_TRACK_ID,
  registerEditorTrack,
  trackCentreline,
  trackGeometryRevision,
  type CircuitScalePreset,
  type GridDefinition,
  type PitLaneDefinition,
  type PitLanePathPoint,
  type TrackDefinition,
  type TrackPoint,
} from './TrackModel';

export type { CircuitScalePreset } from './TrackModel';

export interface CircuitControlPoint extends TrackPoint {
  /** Intended local road half-width in metres. Runtime width support is wired by the editor integration layer. */
  roadHalfWidth?: number;
}

export interface CircuitReferenceSeed {
  /** One authored lane offset for each control point. Positive is track-left. */
  laneOffsets: number[];
}

export interface CircuitAsset {
  version: 1;
  id: typeof EDITOR_TRACK_ID;
  name: string;
  subtitle: string;
  scalePreset: CircuitScalePreset;
  controls: CircuitControlPoint[];
  /** Control point that becomes progress 0 / start-finish when installed. */
  startControlIndex: number;
  sectorBoundaries: [number, number];
  pitLane: PitLaneDefinition & {
    exitProgress: number;
    path: PitLanePathPoint[];
  };
  grid: GridDefinition;
  referenceLine: CircuitReferenceSeed;
}

export interface CircuitAssetValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const STORAGE_KEY = 'pitwall-racer:circuit-editor:v1';

export interface CircuitAssetStorage extends RacingLineSelectionStorage {}

export function createDefaultCircuitAsset(): CircuitAsset {
  return {
    version: 1,
    id: EDITOR_TRACK_ID,
    name: 'FOUNDRY LOOP',
    subtitle: 'EDITOR · TECHNICAL · MIXED SPEED',
    scalePreset: 'COMPACT',
    controls: [
      { x: 520, y: 880, roadHalfWidth: 17 },
      { x: 900, y: 930, roadHalfWidth: 17 },
      { x: 1320, y: 880, roadHalfWidth: 17 },
      { x: 1580, y: 740, roadHalfWidth: 17 },
      { x: 1510, y: 570, roadHalfWidth: 17 },
      { x: 1250, y: 500, roadHalfWidth: 17 },
      { x: 1050, y: 600, roadHalfWidth: 17 },
      { x: 870, y: 520, roadHalfWidth: 17 },
      { x: 650, y: 430, roadHalfWidth: 17 },
      { x: 430, y: 520, roadHalfWidth: 17 },
      { x: 350, y: 690, roadHalfWidth: 17 },
      { x: 410, y: 820, roadHalfWidth: 17 },
    ],
    startControlIndex: 0,
    sectorBoundaries: [0.34, 0.67],
    pitLane: {
      entryProgress: 0.88,
      exitProgress: 0.08,
      lengthMetres: 330,
      laneOffset: 30,
      path: [
        { t: 0, laneOffset: 11 },
        { t: 0.12, laneOffset: 24 },
        { t: 0.30, laneOffset: 30 },
        { t: 0.70, laneOffset: 30 },
        { t: 0.88, laneOffset: 24 },
        { t: 1, laneOffset: 11 },
      ],
    },
    grid: {
      frontGapMetres: 9,
      longitudinalStepMetres: 12,
      laneOffset: 4.2,
    },
    referenceLine: {
      laneOffsets: [0, -2, -4, -5, 3, 5, -2, -5, 4, 5, 2, 0],
    },
  };
}

export function validateCircuitAsset(asset: CircuitAsset): CircuitAssetValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (asset.version !== 1) errors.push('Unsupported circuit asset version.');
  if (asset.id !== EDITOR_TRACK_ID) errors.push('Editor assets must use the editor-custom runtime id.');
  if (!asset.name.trim()) errors.push('Circuit name is required.');
  if (asset.controls.length < 6) errors.push('A circuit needs at least 6 control points.');
  if (asset.referenceLine.laneOffsets.length !== asset.controls.length) {
    errors.push('Reference-line offsets must match the control-point count.');
  } else {
    asset.referenceLine.laneOffsets.forEach((offset, index) => {
      const roadHalfWidth = asset.controls[index]?.roadHalfWidth ?? 17;
      const safeLane = Math.max(1, roadHalfWidth - 3.15);
      if (!Number.isFinite(offset)) {
        errors.push(`Reference-line offset ${index + 1} is not finite.`);
      } else if (Math.abs(offset) > safeLane) {
        errors.push(
          `Reference-line offset ${index + 1} exceeds the local safe lane (${safeLane.toFixed(1)} m).`,
        );
      }
    });
  }
  if (
    asset.startControlIndex < 0
    || asset.startControlIndex >= Math.max(1, asset.controls.length)
    || !Number.isInteger(asset.startControlIndex)
  ) {
    errors.push('Start/finish control index is out of range.');
  }

  asset.controls.forEach((point, index) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      errors.push(`Control point ${index + 1} has non-finite coordinates.`);
    }
    if (
      point.roadHalfWidth !== undefined
      && (!Number.isFinite(point.roadHalfWidth) || point.roadHalfWidth < 8 || point.roadHalfWidth > 36)
    ) {
      errors.push(`Control point ${index + 1} road half-width must be 8–36 m.`);
    }
  });

  const [s1, s2] = asset.sectorBoundaries;
  if (!(s1 > 0.05 && s1 < s2 && s2 < 0.95)) {
    errors.push('Sector boundaries must be ordered inside the lap (0.05 < S1 < S2 < 0.95).');
  }

  const pit = asset.pitLane;
  if (!isProgress(pit.entryProgress) || !isProgress(pit.exitProgress)) {
    errors.push('Pit entry and exit must be lap-progress values in [0, 1).');
  }
  if (!Number.isFinite(pit.lengthMetres) || pit.lengthMetres < 120 || pit.lengthMetres > 1600) {
    errors.push('Pit-lane length must be between 120 m and 1600 m.');
  }
  if (!Number.isFinite(pit.laneOffset) || Math.abs(pit.laneOffset) < 10 || Math.abs(pit.laneOffset) > 80) {
    errors.push('Pit-lane offset magnitude must be between 10 m and 80 m.');
  }

  const pitPath = pit.path ?? [];
  if (pitPath.length < 4 || pitPath.length > 12) {
    errors.push('Pit-lane path must contain 4–12 control points.');
  } else {
    const side = Math.sign(pit.laneOffset) || 1;
    pitPath.forEach((point, index) => {
      if (!Number.isFinite(point.t) || !Number.isFinite(point.laneOffset)) {
        errors.push(`Pit-lane path point ${index + 1} must contain finite values.`);
        return;
      }
      if (point.t < 0 || point.t > 1) {
        errors.push(`Pit-lane path point ${index + 1} t must be inside [0, 1].`);
      }
      if (Math.abs(point.laneOffset) > 80) {
        errors.push(`Pit-lane path point ${index + 1} offset exceeds 80 m.`);
      }
      if (point.laneOffset * side < 8) {
        errors.push(`Pit-lane path point ${index + 1} crosses the circuit centreline or entry gate.`);
      }
      if (index > 0 && point.t <= pitPath[index - 1].t) {
        errors.push('Pit-lane path t values must be strictly increasing.');
      }
    });
    if (Math.abs(pitPath[0].t) > 0.0001 || Math.abs(pitPath[pitPath.length - 1].t - 1) > 0.0001) {
      errors.push('Pit-lane path must start at t=0 and end at t=1.');
    }
    const peakOffset = Math.max(...pitPath.map((point) => Math.abs(point.laneOffset)));
    if (peakOffset < 18) {
      warnings.push('Pit lane never separates far from the racing surface.');
    }
  }

  if (asset.controls.length >= 4 && hasSelfIntersection(asset.controls)) {
    errors.push('Control polygon self-intersects. Move points until the loop is non-crossing.');
  }

  const span = circularForwardSpan(pit.entryProgress, pit.exitProgress);
  if (span < 0.025) warnings.push('Pit entry and exit are extremely close together.');

  const averageWidth = asset.controls.reduce(
    (sum, point) => sum + (point.roadHalfWidth ?? 17),
    0,
  ) / Math.max(1, asset.controls.length);
  if (averageWidth < 11) warnings.push('This circuit is very narrow for an 8-car field.');

  return { valid: errors.length === 0, errors, warnings };
}

export function saveCircuitAsset(
  storage: CircuitAssetStorage,
  asset: CircuitAsset,
): CircuitAsset {
  const normalized = normalizeCircuitAsset(asset);
  const validation = validateCircuitAsset(normalized);
  if (!validation.valid) {
    throw new Error(validation.errors.join(' '));
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function loadCircuitAsset(
  storage: CircuitAssetStorage,
): CircuitAsset | undefined {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CircuitAsset;
    const normalized = normalizeCircuitAsset(parsed);
    return validateCircuitAsset(normalized).valid ? normalized : undefined;
  } catch {
    return undefined;
  }
}

export function exportCircuitAsset(asset: CircuitAsset): string {
  const normalized = normalizeCircuitAsset(asset);
  const validation = validateCircuitAsset(normalized);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return JSON.stringify(normalized, null, 2);
}

export function importCircuitAsset(text: string): CircuitAsset {
  const parsed = JSON.parse(text) as CircuitAsset;
  const normalized = normalizeCircuitAsset(parsed);
  const validation = validateCircuitAsset(normalized);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return normalized;
}

/**
 * Register one editor-authored circuit into the ordinary TrackModel path.
 * The editor owns one replaceable runtime slot so all existing race/qualifying
 * systems can use it without introducing stringly-typed arbitrary track ids.
 */
export function installCircuitAsset(
  asset: CircuitAsset,
  storage?: CircuitAssetStorage,
): TrackDefinition {
  const normalized = normalizeCircuitAsset(asset);
  const validation = validateCircuitAsset(normalized);
  if (!validation.valid) throw new Error(validation.errors.join(' '));

  const rotatedControls = rotate(normalized.controls, normalized.startControlIndex);
  const controls = rotatedControls.map(({ x, y }) => ({ x, y }));
  const roadHalfWidths = rotatedControls.map((point) => point.roadHalfWidth ?? 17);
  const definition: TrackDefinition = {
    id: EDITOR_TRACK_ID,
    name: normalized.name,
    subtitle: normalized.subtitle,
    controls,
    roadHalfWidths,
    referenceLaneMode: 'centerline',
    distanceScale: scaleDistance(normalized.scalePreset),
    scalePreset: normalized.scalePreset,
    referenceLapSeconds: estimatedReferenceLapSeconds(controls, normalized.scalePreset),
    sectorBoundaries: normalized.sectorBoundaries,
    pitLane: normalized.pitLane,
    grid: normalized.grid,
    editorAuthored: true,
  };
  registerEditorTrack(definition);

  if (storage) {
    saveEditorRacingLine(storage, circuitReferenceLineAsset(normalized));
  }
  return definition;
}

export function installStoredCircuitAsset(
  storage: CircuitAssetStorage,
): CircuitAsset | undefined {
  const asset = loadCircuitAsset(storage);
  if (!asset) return undefined;
  installCircuitAsset(asset, storage);
  return asset;
}

export function circuitReferenceLineAsset(asset: CircuitAsset): RacingLineAsset {
  // Ensure TrackModel is using the geometry this line belongs to before
  // stamping its fingerprint.
  installCircuitAsset(asset);
  const offsets = rotate(asset.referenceLine.laneOffsets, asset.startControlIndex);
  const centreline = trackCentreline(EDITOR_TRACK_ID);
  const points = centreline.map((_, index) => {
    const progress = index / centreline.length;
    return {
      progress,
      laneOffset: sampleCircular(offsets, progress),
      targetSpeed: 58,
    };
  });
  return {
    version: 1,
    trackId: EDITOR_TRACK_ID,
    trackRevision: trackGeometryRevision(EDITOR_TRACK_ID),
    source: 'EDITOR',
    points,
  };
}

function normalizeCircuitAsset(asset: CircuitAsset): CircuitAsset {
  return {
    version: 1,
    id: EDITOR_TRACK_ID,
    name: String(asset?.name ?? '').trim().slice(0, 42),
    subtitle: String(asset?.subtitle ?? 'EDITOR CIRCUIT').trim().slice(0, 72),
    scalePreset: isScalePreset(asset?.scalePreset) ? asset.scalePreset : 'COMPACT',
    controls: Array.isArray(asset?.controls)
      ? asset.controls.map((point) => ({
          x: Number(point.x),
          y: Number(point.y),
          roadHalfWidth: point.roadHalfWidth === undefined ? 17 : Number(point.roadHalfWidth),
        }))
      : [],
    startControlIndex: Number.isInteger(asset?.startControlIndex)
      ? asset.startControlIndex
      : 0,
    sectorBoundaries: [
      Number(asset?.sectorBoundaries?.[0] ?? 1 / 3),
      Number(asset?.sectorBoundaries?.[1] ?? 2 / 3),
    ],
    pitLane: {
      entryProgress: Number(asset?.pitLane?.entryProgress ?? 0.88),
      exitProgress: Number(asset?.pitLane?.exitProgress ?? 0.08),
      lengthMetres: Number(
        asset?.pitLane?.lengthMetres
        ?? recommendedPitLaneLengthForScale(
          isScalePreset(asset?.scalePreset) ? asset.scalePreset : 'COMPACT',
        ),
      ),
      laneOffset: Number(asset?.pitLane?.laneOffset ?? 30),
      path: normalizePitPath(
        asset?.pitLane?.path,
        Number(asset?.pitLane?.laneOffset ?? 30),
      ),
    },
    grid: {
      frontGapMetres: Number(asset?.grid?.frontGapMetres ?? 9),
      longitudinalStepMetres: Number(asset?.grid?.longitudinalStepMetres ?? 12),
      laneOffset: Number(asset?.grid?.laneOffset ?? 4.2),
    },
    referenceLine: {
      laneOffsets: Array.isArray(asset?.referenceLine?.laneOffsets)
        ? asset.referenceLine.laneOffsets.map(Number)
        : [],
    },
  };
}

function normalizePitPath(
  path: readonly PitLanePathPoint[] | undefined,
  nominalOffset: number,
): PitLanePathPoint[] {
  if (Array.isArray(path) && path.length > 0) {
    return path.map((point) => ({
      t: Number(point.t),
      laneOffset: Number(point.laneOffset),
    }));
  }

  const side = Math.sign(nominalOffset) || 1;
  const peak = Math.max(10, Math.abs(nominalOffset)) * side;
  const entry = 11 * side;
  return [
    { t: 0, laneOffset: entry },
    { t: 0.12, laneOffset: peak * 0.8 },
    { t: 0.30, laneOffset: peak },
    { t: 0.70, laneOffset: peak },
    { t: 0.88, laneOffset: peak * 0.8 },
    { t: 1, laneOffset: entry },
  ];
}

export function recommendedPitLaneLengthForScale(
  scalePreset: CircuitScalePreset,
): number {
  return scalePreset === 'COMPACT' ? 330 : scalePreset === 'LONG' ? 560 : 480;
}

function estimatedReferenceLapSeconds(
  controls: readonly TrackPoint[],
  scalePreset: CircuitScalePreset,
): number {
  let length = 0;
  for (let index = 0; index < controls.length; index++) {
    const a = controls[index];
    const b = controls[(index + 1) % controls.length];
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const nominalSpeed = scalePreset === 'COMPACT' ? 52 : scalePreset === 'STANDARD' ? 61 : 67;
  return Math.max(18, Math.min(130, length / nominalSpeed));
}

function scaleDistance(preset: CircuitScalePreset): number {
  return preset === 'COMPACT' ? 0.42 : 1;
}

function hasSelfIntersection(points: readonly TrackPoint[]): boolean {
  for (let i = 0; i < points.length; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j++) {
      if (j === i || j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const b1 = points[j];
      const b2 = points[(j + 1) % points.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function segmentsIntersect(a: TrackPoint, b: TrackPoint, c: TrackPoint, d: TrackPoint): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return ((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0));
}

function cross(a: TrackPoint, b: TrackPoint, c: TrackPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function rotate<T>(values: readonly T[], start: number): T[] {
  if (values.length === 0) return [];
  const index = ((start % values.length) + values.length) % values.length;
  return [...values.slice(index), ...values.slice(0, index)];
}

function sampleCircular(values: readonly number[], progress: number): number {
  if (values.length === 0) return 0;
  const p = ((progress % 1) + 1) % 1;
  const scaled = p * values.length;
  const index = Math.floor(scaled) % values.length;
  const next = (index + 1) % values.length;
  const t = scaled - Math.floor(scaled);
  return values[index] + (values[next] - values[index]) * t;
}

function isScalePreset(value: unknown): value is CircuitScalePreset {
  return value === 'COMPACT' || value === 'STANDARD' || value === 'LONG';
}

function isProgress(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value < 1;
}

function circularForwardSpan(start: number, end: number): number {
  return ((end - start) % 1 + 1) % 1;
}
