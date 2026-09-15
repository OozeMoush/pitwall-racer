import { referenceTarget } from './ReferenceDriverModel';
import type { TrackId } from './TrackModel';
import { TRACK_LENGTH } from './TrackModel';

export interface PitwallApexTarget {
  progress: number;
  distanceMetres: number;
  laneOffset: number;
}

/**
 * Fixed-distance pure pursuit can point through the first half of a chicane.
 * Pitwall is compact enough that a 25-40 m gaze sometimes lands between two
 * opposing apexes, which is exactly where a human driver would *not* aim.
 *
 * In the two rapid-direction-change zones, scan the already-generated legal
 * reference line and return the first meaningful local lane extremum ahead.
 * The controller can then commit to one apex at a time. No physics or pace is
 * changed here; this only chooses a better geometric steering target.
 */
export function nextPitwallReferenceApex(
  trackId: TrackId,
  progress: number,
  tireGrip: number,
): PitwallApexTarget | undefined {
  if (trackId !== 'pitwall-gp' || !isTechnicalWindow(progress)) return undefined;

  const stepMetres = 5;
  const minimumDistance = 11;
  const maximumDistance = 62;
  let previousDistance = 0;
  let previousLane = referenceTarget(trackId, progress, tireGrip).laneOffset;
  let currentDistance = stepMetres;
  let currentLane = referenceTarget(
    trackId,
    progress + currentDistance / TRACK_LENGTH,
    tireGrip,
  ).laneOffset;
  let previousSlope = currentLane - previousLane;

  for (let nextDistance = stepMetres * 2; nextDistance <= maximumDistance + stepMetres; nextDistance += stepMetres) {
    const nextProgress = progress + nextDistance / TRACK_LENGTH;
    const nextLane = referenceTarget(trackId, nextProgress, tireGrip).laneOffset;
    const nextSlope = nextLane - currentLane;
    const turnsAround = previousSlope * nextSlope <= 0
      && Math.abs(previousSlope - nextSlope) > 0.20;
    const meaningfulApex = Math.abs(currentLane) > 2.2
      || Math.max(Math.abs(previousSlope), Math.abs(nextSlope)) > 0.65;

    if (currentDistance >= minimumDistance && turnsAround && meaningfulApex) {
      return {
        progress: wrap01(progress + currentDistance / TRACK_LENGTH),
        distanceMetres: currentDistance,
        laneOffset: currentLane,
      };
    }

    previousDistance = currentDistance;
    previousLane = currentLane;
    currentDistance = nextDistance;
    currentLane = nextLane;
    previousSlope = nextSlope;
  }

  void previousDistance;
  void previousLane;
  return undefined;
}

function isTechnicalWindow(progress: number): boolean {
  const p = wrap01(progress);
  return (p >= 0.44 && p <= 0.74) || p >= 0.78 || p <= 0.025;
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}
