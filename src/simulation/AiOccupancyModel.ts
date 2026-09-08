import type { DriverState } from './RaceModel';
import { raceDistance } from './RaceModel';
import { TRACK_LENGTH } from './TrackModel';

const LANE_OPTIONS = [-44, -22, 0, 22, 44] as const;
const CONFLICT_LONGITUDINAL = 34;
const REQUIRED_LATERAL = 28;
const HARD_LONGITUDINAL_BUFFER = 16;

/**
 * Lightweight race-game occupancy resolver for the abstract AI field.
 *
 * The AI still drives a cheap 1D progress model, but rendered cars must not
 * visually sit inside each other. Nearby cars first fan into available lanes;
 * if there is no lateral room yet, the trailing car is held a short distance
 * behind instead of ghosting through the car in front.
 */
export function resolveAiOccupancy(drivers: DriverState[], dt: number): DriverState[] {
  const result = drivers.map((driver) => ({ ...driver }));
  const order = result
    .map((driver, index) => ({ driver, index }))
    .filter(({ driver }) => !driver.finished)
    .sort((a, b) => raceDistance(b.driver.lap, b.driver.progress) - raceDistance(a.driver.lap, a.driver.progress));

  const placed: DriverState[] = [];

  for (const { driver } of order) {
    let working = driver;
    const workingDistance = raceDistance(working.lap, working.progress) * TRACK_LENGTH;
    const nearbyAhead = placed.filter((other) => {
      const gap = raceDistance(other.lap, other.progress) * TRACK_LENGTH - workingDistance;
      return gap >= 0 && gap < CONFLICT_LONGITUDINAL;
    });

    if (nearbyAhead.length > 0) {
      const candidates = [...LANE_OPTIONS].sort((a, b) => Math.abs(a - working.laneOffset) - Math.abs(b - working.laneOffset));
      const freeLane = candidates.find((candidate) => nearbyAhead.every((other) => Math.abs(candidate - other.laneOffset) >= REQUIRED_LATERAL));

      if (freeLane !== undefined) {
        working.laneOffset = approach(working.laneOffset, freeLane, 76 * dt);
      }

      const stillConflicting = nearbyAhead
        .map((other) => ({
          other,
          gap: raceDistance(other.lap, other.progress) * TRACK_LENGTH - raceDistance(working.lap, working.progress) * TRACK_LENGTH,
          lateral: Math.abs(other.laneOffset - working.laneOffset),
        }))
        .filter(({ gap, lateral }) => gap >= 0 && gap < HARD_LONGITUDINAL_BUFFER && lateral < REQUIRED_LATERAL)
        .sort((a, b) => a.gap - b.gap)[0];

      if (stillConflicting) {
        working.speed = Math.min(working.speed, stillConflicting.other.speed * 0.985);
        const leaderDistance = raceDistance(stillConflicting.other.lap, stillConflicting.other.progress) * TRACK_LENGTH;
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

function approach(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}
