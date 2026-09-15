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
 * In the rapid-direction-change zones, scan the legal reference line and pick
 * meaningful local extrema. When the first apex is already close, begin a
 * measured hand-off toward the following apex before the first kerb is fully
 * behind the car. This is intentionally between the old late 6-18% hand-off
 * and the rejected 22-52% experiment that made the car jump across the road.
 */
export function nextPitwallReferenceApex(
  trackId: TrackId,
  progress: number,
  tireGrip: number,
): PitwallApexTarget | undefined {
  if (trackId !== 'pitwall-gp' || !isTechnicalWindow(progress)) return undefined;

  const stepMetres = 4;
  const minimumDistance = 4;
  const maximumDistance = 92;
  const earlyHandoffDistance = 16;

  let previousLane = referenceTarget(trackId, progress, tireGrip).laneOffset;
  let currentDistance = stepMetres;
  let currentLane = referenceTarget(
    trackId,
    progress + currentDistance / TRACK_LENGTH,
    tireGrip,
  ).laneOffset;
  let previousSlope = currentLane - previousLane;
  let firstApex: PitwallApexTarget | undefined;

  for (let nextDistance = stepMetres * 2; nextDistance <= maximumDistance + stepMetres; nextDistance += stepMetres) {
    const nextProgress = progress + nextDistance / TRACK_LENGTH;
    const nextLane = referenceTarget(trackId, nextProgress, tireGrip).laneOffset;
    const nextSlope = nextLane - currentLane;
    const turnsAround = previousSlope * nextSlope <= 0
      && Math.abs(previousSlope - nextSlope) > 0.16;
    const meaningfulApex = Math.abs(currentLane) > 2.0
      || Math.max(Math.abs(previousSlope), Math.abs(nextSlope)) > 0.58;

    if (currentDistance >= minimumDistance && turnsAround && meaningfulApex) {
      const apex: PitwallApexTarget = {
        progress: wrap01(progress + currentDistance / TRACK_LENGTH),
        distanceMetres: currentDistance,
        laneOffset: currentLane,
      };

      if (!firstApex) {
        firstApex = apex;
        if (firstApex.distanceMetres > earlyHandoffDistance) return firstApex;
      } else {
        const gap = apex.distanceMetres - firstApex.distanceMetres;
        const urgency = clamp(
          (earlyHandoffDistance - firstApex.distanceMetres) / earlyHandoffDistance,
          0,
          1,
        );
        const handoffFraction = 0.10 + urgency * 0.16;
        const handoffDistance = firstApex.distanceMetres + gap * handoffFraction;
        const handoffProgress = wrap01(progress + handoffDistance / TRACK_LENGTH);

        return {
          progress: handoffProgress,
          distanceMetres: handoffDistance,
          laneOffset: referenceTarget(trackId, handoffProgress, tireGrip).laneOffset,
        };
      }
    }

    previousLane = currentLane;
    currentDistance = nextDistance;
    currentLane = nextLane;
    previousSlope = nextSlope;
  }

  return firstApex;
}

function isTechnicalWindow(progress: number): boolean {
  const p = wrap01(progress);
  return (p >= 0.42 && p <= 0.75) || p >= 0.77 || p <= 0.03;
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
