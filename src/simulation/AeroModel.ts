import { TRACK_LENGTH } from './TrackModel';

export interface AeroCarPose {
  id: string;
  lap: number;
  progress: number;
  laneOffset: number;
}

export interface SharedAeroEffect {
  tow: number;
  dirtyAir: number;
  sourceId?: string;
}

const MAX_WAKE_DISTANCE = 78;
const MIN_WAKE_DISTANCE = 6;
const TOW_HALF_WIDTH = 22;
const DIRTY_HALF_WIDTH = 11.5;
const SIDE_BY_SIDE_LONGITUDINAL = 18;
const SIDE_BY_SIDE_LATERAL = 7;

/**
 * Lightweight game-facing aero wake model shared by player and AI.
 *
 * - Tow has a wider wake than dirty air.
 * - Dirty air is strongest only when sitting close to the car ahead's line.
 * - Once a car genuinely pulls alongside, both effects collapse so moving out
 *   of the wake before turn-in is a meaningful racecraft action.
 */
export function aerodynamicEffect(
  subject: AeroCarPose,
  traffic: readonly AeroCarPose[],
): SharedAeroEffect {
  const subjectDistance = raceMetres(subject);
  let tow = 0;
  let dirtyAir = 0;
  let sourceId: string | undefined;
  let strongest = 0;

  for (const other of traffic) {
    if (other.id === subject.id) continue;
    const longitudinal = raceMetres(other) - subjectDistance;
    if (longitudinal <= MIN_WAKE_DISTANCE || longitudinal > MAX_WAKE_DISTANCE) continue;

    const lateral = Math.abs(other.laneOffset - subject.laneOffset);
    if (longitudinal < SIDE_BY_SIDE_LONGITUDINAL && lateral > SIDE_BY_SIDE_LATERAL) continue;

    const longitudinalStrength = clamp01(
      (MAX_WAKE_DISTANCE - longitudinal) / (MAX_WAKE_DISTANCE - MIN_WAKE_DISTANCE),
    );
    const towStrength = 0.105 * longitudinalStrength * clamp01(1 - lateral / TOW_HALF_WIDTH);
    const dirtyStrength = 0.18 * longitudinalStrength * clamp01(1 - lateral / DIRTY_HALF_WIDTH);

    tow = Math.max(tow, towStrength);
    dirtyAir = Math.max(dirtyAir, dirtyStrength);
    const combined = towStrength + dirtyStrength;
    if (combined > strongest) {
      strongest = combined;
      sourceId = other.id;
    }
  }

  return { tow, dirtyAir, sourceId };
}

function raceMetres(car: AeroCarPose): number {
  return (Math.max(0, car.lap) + car.progress) * TRACK_LENGTH;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
