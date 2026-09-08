import type { DriverState } from './RaceModel';
import { raceDistance } from './RaceModel';
import { TRACK_LENGTH } from './TrackModel';

// The rendered formula car is about 5.4 world units long. At WORLD_SCALE 0.085
// that is roughly 64 simulation units, so the old 18-unit buffer literally
// allowed three quarters of one car to sit inside another.
const LANE_OPTIONS = [-42, 0, 42] as const;
const CONFLICT_LONGITUDINAL = 105;
const REQUIRED_LATERAL = 31;
const HARD_LONGITUDINAL_BUFFER = 68;

/**
 * Lightweight race-game occupancy resolver for the abstract AI field.
 * Cars may run side by side, but they may not occupy the same body volume.
 * A third car with no safe lane is held behind rather than rendered inside the
 * pack. This is intentionally stronger than a tiny collision impulse because
 * readable racecraft matters more than pretending the 1D AI has rigid bodies.
 */
export function resolveAiOccupancy(drivers: DriverState[], _dt?: number): DriverState[] {
  const result = drivers.map((driver) => ({ ...driver }));
  const order = result
    .filter((driver) => !driver.finished)
    .sort((a, b) => raceDistance(b.lap, b.progress) - raceDistance(a.lap, a.progress));

  const placed: DriverState[] = [];

  for (const driver of order) {
    let working = driver;
    const workingDistance = raceDistance(working.lap, working.progress) * TRACK_LENGTH;
    const nearbyAhead = placed.filter((other) => {
      const gap = raceDistance(other.lap, other.progress) * TRACK_LENGTH - workingDistance;
      return gap >= 0 && gap < CONFLICT_LONGITUDINAL;
    });

    if (nearbyAhead.length > 0) {
      const candidates = [working.laneOffset, ...LANE_OPTIONS]
        .filter((candidate, index, values) => values.indexOf(candidate) === index)
        .map((candidate) => clamp(candidate, -46, 46))
        .sort((a, b) => Math.abs(a - working.laneOffset) - Math.abs(b - working.laneOffset));
      const freeLane = candidates.find((candidate) => nearbyAhead.every((other) => Math.abs(candidate - other.laneOffset) >= REQUIRED_LATERAL));

      if (freeLane !== undefined) {
        working.laneOffset = freeLane;
      } else {
        const nearest = nearbyAhead
          .map((other) => ({
            other,
            gap: raceDistance(other.lap, other.progress) * TRACK_LENGTH - workingDistance,
          }))
          .sort((a, b) => a.gap - b.gap)[0];

        working.speed = Math.min(working.speed, nearest.other.speed * 0.97);
        const leaderDistance = raceDistance(nearest.other.lap, nearest.other.progress) * TRACK_LENGTH;
        working = placeAtRaceMetres(working, Math.max(0, leaderDistance - HARD_LONGITUDINAL_BUFFER));
      }
    }

    placed.push(working);
    const targetIndex = result.findIndex((candidate) => candidate.id === working.id);
    result[targetIndex] = working;
  }

  return result;
}

function placeAtRaceMetres(driver: DriverState, metres: number): DriverState {
  const normalized = metres / TRACK_LENGTH;
  const completedLaps = Math.floor(normalized);
  return {
    ...driver,
    lap: completedLaps + 1,
    progress: normalized - completedLaps,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
