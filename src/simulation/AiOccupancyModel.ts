import type { DriverState } from './RaceModel';
import { raceDistance } from './RaceModel';
import { TRACK_LENGTH } from './TrackModel';

const LANE_OPTIONS = [-44, -22, 0, 22, 44] as const;
const CONFLICT_LONGITUDINAL = 34;
const REQUIRED_LATERAL = 28;
const HARD_LONGITUDINAL_BUFFER = 18;

/**
 * Lightweight race-game occupancy resolver for the abstract AI field.
 *
 * The AI still drives a cheap 1D progress model, but rendered cars must not
 * visually sit inside each other. Nearby cars are assigned a free lateral lane
 * first. If the local pack is too dense for another lane, the trailing car is
 * held a short distance behind instead of ghosting through the car in front.
 */
export function resolveAiOccupancy(drivers: DriverState[]): DriverState[] {
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
        .sort((a, b) => Math.abs(a - working.laneOffset) - Math.abs(b - working.laneOffset));
      const freeLane = candidates.find((candidate) => nearbyAhead.every((other) => Math.abs(candidate - other.laneOffset) >= REQUIRED_LATERAL));

      if (freeLane !== undefined) {
        // This is deliberate race-game space ownership, not a physics impulse.
        // A small lane snap is less distracting than six cars visibly sharing
        // the same body volume for an entire corner.
        working.laneOffset = clamp(freeLane, -48, 48);
      } else {
        const nearest = nearbyAhead
          .map((other) => ({
            other,
            gap: raceDistance(other.lap, other.progress) * TRACK_LENGTH - workingDistance,
          }))
          .sort((a, b) => a.gap - b.gap)[0];

        working.speed = Math.min(working.speed, nearest.other.speed * 0.985);
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
