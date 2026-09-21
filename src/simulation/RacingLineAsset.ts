import type { TrackId } from './TrackModel';

export type RacingLineSource = 'AUTO' | 'PLAYER' | 'EDITOR' | 'OPTIMIZER';

export interface RacingLinePoint {
  progress: number;
  laneOffset: number;
  targetSpeed: number;
}

export interface RacingLineAsset {
  version: 1;
  trackId: TrackId;
  source: RacingLineSource;
  referenceGrip?: number;
  lapSeconds?: number;
  points: readonly RacingLinePoint[];
}

export function sampleRacingLineAsset(
  asset: RacingLineAsset,
  progress: number,
): RacingLinePoint {
  if (asset.points.length === 0) {
    return { progress: wrap01(progress), laneOffset: 0, targetSpeed: 0 };
  }

  const p = wrap01(progress);
  const scaled = p * asset.points.length;
  const index = Math.floor(scaled) % asset.points.length;
  const nextIndex = (index + 1) % asset.points.length;
  const t = scaled - Math.floor(scaled);
  const a = asset.points[index];
  const b = asset.points[nextIndex];

  return {
    progress: p,
    laneOffset: lerp(a.laneOffset, b.laneOffset, t),
    targetSpeed: lerp(a.targetSpeed, b.targetSpeed, t),
  };
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
