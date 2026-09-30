import { afterEach, describe, expect, it } from 'vitest';
import {
  circuitReferenceLineAsset,
  createDefaultCircuitAsset,
  exportCircuitAsset,
  importCircuitAsset,
  installCircuitAsset,
  loadCircuitAsset,
  saveCircuitAsset,
  validateCircuitAsset,
  type CircuitAssetStorage,
} from './CircuitAsset';
import { loadEditorRacingLine } from './RacingLineSelectionStore';
import {
  EDITOR_TRACK_ID,
  getTrackDefinition,
  sectorBoundariesFor,
  setActiveTrack,
  trackGeometryRevision,
} from './TrackModel';
import { gridSlotForPosition } from './GridModel';
import {
  pitEntryProgress,
  pitExitProgress,
  pitLaneOffset,
  shouldEnterPit,
} from './PitLaneModel';
import { hasSafetyBarrier, trackRoadHalfWidth } from './TrackLimitsModel';
import { surfaceEffect } from './SurfaceModel';

afterEach(() => setActiveTrack('pitwall-gp'));

class MemoryStorage implements CircuitAssetStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('CircuitAsset', () => {
  it('round-trips a deterministic valid editor asset', () => {
    const asset = createDefaultCircuitAsset();
    expect(validateCircuitAsset(asset).valid).toBe(true);

    const exported = exportCircuitAsset(asset);
    const imported = importCircuitAsset(exported);

    expect(imported).toEqual(asset);
    expect(exportCircuitAsset(imported)).toBe(exported);
  });

  it('migrates older editor assets that did not store an explicit pit path', () => {
    const legacy = JSON.parse(exportCircuitAsset(createDefaultCircuitAsset())) as Record<string, any>;
    delete legacy.pitLane.path;

    const imported = importCircuitAsset(JSON.stringify(legacy));

    expect(imported.pitLane.path.length).toBeGreaterThanOrEqual(4);
    expect(imported.pitLane.path[0].t).toBe(0);
    expect(imported.pitLane.path[imported.pitLane.path.length - 1].t).toBe(1);
    expect(validateCircuitAsset(imported).valid).toBe(true);
  });

  it('persists and installs through the ordinary TrackModel runtime slot', () => {
    const storage = new MemoryStorage();
    const asset = createDefaultCircuitAsset();
    asset.name = 'TEST FOUNDRY';
    asset.sectorBoundaries = [0.28, 0.73];
    asset.grid = {
      frontGapMetres: 14,
      longitudinalStepMetres: 16,
      laneOffset: 5,
    };

    saveCircuitAsset(storage, asset);
    expect(loadCircuitAsset(storage)?.name).toBe('TEST FOUNDRY');

    installCircuitAsset(asset, storage);
    setActiveTrack(EDITOR_TRACK_ID);

    expect(getTrackDefinition(EDITOR_TRACK_ID).name).toBe('TEST FOUNDRY');
    expect(sectorBoundariesFor(EDITOR_TRACK_ID)).toEqual([0.28, 0.73]);
    expect(gridSlotForPosition(1).laneOffset).toBeCloseTo(-5, 6);
    expect(gridSlotForPosition(2).laneOffset).toBeCloseTo(5, 6);
    expect(pitEntryProgress()).toBeCloseTo(asset.pitLane.entryProgress, 6);
    expect(pitExitProgress()).toBeCloseTo(asset.pitLane.exitProgress, 6);

    const line = loadEditorRacingLine(storage, EDITOR_TRACK_ID);
    expect(line).toBeDefined();
    expect(line?.trackRevision).toBe(trackGeometryRevision(EDITOR_TRACK_ID));
  });

  it('moves start-finish by rotating the authored controls', () => {
    const asset = createDefaultCircuitAsset();
    asset.startControlIndex = 3;
    const expectedStart = asset.controls[3];

    installCircuitAsset(asset);
    const installed = getTrackDefinition(EDITOR_TRACK_ID);

    expect(installed.controls[0].x).toBe(expectedStart.x);
    expect(installed.controls[0].y).toBe(expectedStart.y);
  });

  it('builds an EDITOR reference line from authored offsets', () => {
    const asset = createDefaultCircuitAsset();
    installCircuitAsset(asset);
    const line = circuitReferenceLineAsset(asset);

    expect(line.source).toBe('EDITOR');
    expect(line.trackId).toBe(EDITOR_TRACK_ID);
    expect(line.trackRevision).toBe(trackGeometryRevision(EDITOR_TRACK_ID));
    expect(line.points.length).toBeGreaterThan(asset.controls.length * 10);
    expect(line.points.some((point) => Math.abs(point.laneOffset) > 1)).toBe(true);
  });

  it('installs authored local road widths and includes them in geometry revision', () => {
    const asset = createDefaultCircuitAsset();
    asset.controls[0].roadHalfWidth = 10;

    installCircuitAsset(asset);
    setActiveTrack(EDITOR_TRACK_ID);
    const narrowRevision = trackGeometryRevision(EDITOR_TRACK_ID);

    expect(getTrackDefinition(EDITOR_TRACK_ID).roadHalfWidths?.[0]).toBe(10);
    expect(trackRoadHalfWidth(0)).toBeCloseTo(10, 6);
    expect(surfaceEffect(12, 0).label).toBe('RUNOFF');

    asset.controls[0].roadHalfWidth = 12;
    installCircuitAsset(asset);
    setActiveTrack(EDITOR_TRACK_ID);

    expect(trackGeometryRevision(EDITOR_TRACK_ID)).not.toBe(narrowRevision);
    expect(trackRoadHalfWidth(0)).toBeCloseTo(12, 6);
  });

  it('installs and runs an explicitly authored pit-lane route', () => {
    const asset = createDefaultCircuitAsset();
    asset.pitLane.path = [
      { t: 0, laneOffset: 11 },
      { t: 0.20, laneOffset: 20 },
      { t: 0.45, laneOffset: 38 },
      { t: 0.75, laneOffset: 26 },
      { t: 1, laneOffset: 11 },
    ];
    asset.pitLane.laneOffset = 38;

    installCircuitAsset(asset);
    setActiveTrack(EDITOR_TRACK_ID);

    expect(pitLaneOffset(0)).toBeCloseTo(11, 6);
    expect(pitLaneOffset(0.45)).toBeCloseTo(38, 6);
    expect(pitLaneOffset(1)).toBeCloseTo(11, 6);
    expect(pitLaneOffset(0.32)).toBeGreaterThan(20);
    expect(pitLaneOffset(0.32)).toBeLessThan(38);
  });

  it('supports a pit lane authored on the opposite side of the circuit', () => {
    const asset = createDefaultCircuitAsset();
    asset.pitLane.laneOffset = -30;
    asset.pitLane.path = asset.pitLane.path.map((point) => ({
      ...point,
      laneOffset: -Math.abs(point.laneOffset),
    }));

    expect(validateCircuitAsset(asset).valid).toBe(true);
    installCircuitAsset(asset);
    setActiveTrack(EDITOR_TRACK_ID);

    const entry = pitEntryProgress();
    expect(shouldEnterPit(entry - 0.01, entry + 0.001, 20, true, -9)).toBe(true);
    expect(shouldEnterPit(entry - 0.01, entry + 0.001, 20, true, 9)).toBe(false);
    expect(hasSafetyBarrier(entry, -1)).toBe(false);
    expect(hasSafetyBarrier(entry, 1)).toBe(true);
  });

  it('rejects a broken pit route before export or install', () => {
    const asset = createDefaultCircuitAsset();
    asset.pitLane.path[2].t = asset.pitLane.path[1].t;

    const validation = validateCircuitAsset(asset);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((message) =>
      message.includes('strictly increasing')
    )).toBe(true);
  });

  it('rejects an authored reference line outside the local safe road envelope', () => {
    const asset = createDefaultCircuitAsset();
    asset.controls[0].roadHalfWidth = 8;
    asset.referenceLine.laneOffsets[0] = 6;

    const validation = validateCircuitAsset(asset);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((message) =>
      message.includes('exceeds the local safe lane')
    )).toBe(true);
  });

  it('rejects broken/self-intersecting editor layouts', () => {
    const asset = createDefaultCircuitAsset();
    asset.controls = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 100, y: 0 },
      { x: 140, y: -50 },
      { x: -40, y: -50 },
    ];
    asset.referenceLine.laneOffsets = new Array(asset.controls.length).fill(0);

    const validation = validateCircuitAsset(asset);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((message) => message.includes('self-intersects'))).toBe(true);
  });
});
