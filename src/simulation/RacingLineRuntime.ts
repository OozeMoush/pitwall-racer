import { referenceTarget, type ReferenceLapSample } from './ReferenceDriverModel';
import { sampleRacingLineAsset, type RacingLineAsset } from './RacingLineAsset';
import type { TrackId } from './TrackModel';

const active = new Map<TrackId, RacingLineAsset>();

export function setRuntimeRacingLine(
  trackId: TrackId,
  asset?: RacingLineAsset,
): void {
  if (!asset) {
    active.delete(trackId);
    return;
  }
  active.set(trackId, asset);
}

export function runtimeRacingLine(trackId: TrackId): RacingLineAsset | undefined {
  return active.get(trackId);
}

/**
 * Merge an explicit RacingLineAsset with the existing physics-derived reference.
 *
 * The asset owns line placement and relative speed intent. The existing
 * reference still supplies curvature/control hints and transfers the speed
 * profile across tyre-grip changes. This keeps PLAYER/EDITOR lines usable with
 * every compound without copying a human's pedal inputs.
 */
export function activeReferenceTarget(
  trackId: TrackId,
  progress: number,
  tireGrip: number,
): ReferenceLapSample {
  const fallback = referenceTarget(trackId, progress, tireGrip);
  const asset = active.get(trackId);
  if (!asset || asset.points.length === 0) return fallback;

  const selected = sampleRacingLineAsset(asset, progress);
  const sourceGrip = asset.referenceGrip ?? tireGrip;
  const sourceReference = referenceTarget(trackId, progress, sourceGrip);
  const relativeSpeed = sourceReference.targetSpeed > 1
    ? selected.targetSpeed / sourceReference.targetSpeed
    : 1;

  return {
    ...fallback,
    laneOffset: selected.laneOffset,
    targetSpeed: fallback.targetSpeed * clamp(relativeSpeed, 0.72, 1.18),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
