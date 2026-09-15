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
 * reference line and return the next meaningful local lane extremum. When the
 * first apex is already very close, start handing the steering target toward
 * the following apex before the car has fully passed the first one. A good
 * chicane line does not wait until the first kerb is behind the rear axle before
 * preparing the opposite lock.
 *
 * No grip, power or collision rule is changed here; this is only geometric
 * anticipation for the physical steering controller.
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
  const earlyHandoffDistance = 18;

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
        // Blend part-way from the nearly-reached first apex toward the second.
        // This preserves the first clip while beginning the direction change a
        // few metres earlier, which is where the old controller lost most of
        // its time in the 55-60% and final Pitwall complexes.
        const gap = apex.distanceMetres - firstApex.distanceMetres;
        const handoffFraction = clamp(
          0.24 + (earlyHandoffDistance - firstApex.distanceMetres) / earlyHandoffDistance * 0.34,
          0.24,
          0.58,
        );
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
