import { describe, expect, it } from 'vitest';
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
import { pitEntryProgress, pitExitProgress } from './PitLaneModel';

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
