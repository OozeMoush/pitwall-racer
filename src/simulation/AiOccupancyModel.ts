import type { DriverState } from './RaceModel';
import { raceDistance } from './RaceModel';
import { TRACK_LENGTH } from './TrackModel';

const LANE_OPTIONS = [-42, 0, 42] as const;
const CONFLICT_LONGITUDINAL = 105;
const REQUIRED_LATERAL = 31;
const HARD_LONGITUDINAL_BUFFER = 68;

/**
 * Lightweight race-game occupancy resolver for the abstract AI field.
 * Cars may run side by side, but they may not occupy the same body volume.
 * Dense packs form additional longitudinal rows rather than stacking multiple
 * cars into the same fallback position.
 */
export function resolveAiOccupancy(drivers: DriverState[], _dt?: number): DriverState[] {
  const result = drivers.map((driver) => ({ ...driver }));
  const order = result
    .filter((driver) => !driver.finished)
    .sort((a, b) => raceDistance(b.lap, b.progress) - raceDistance(a.lap, a.progress));

  const placed: DriverState[] = [];

  for (const driver of order) {
    let working = driver;
    const workingDistance = raceMetres(working);
    const nearbyAhead = placed.filter((other) => {
      const gap = raceMetres(other) - workingDistance;
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
        working.speed = Math.min(working.speed, Math.min(...nearbyAhead.map((other) => other.speed)) * 0.97);

        // Start one body length behind the rearmost occupied row, then keep
        // stepping back until the new slot is safe from every already-placed car.
        let targetDistance = Math.min(...nearbyAhead.map(raceMetres)) - HARD_LONGITUDINAL_BUFFER;
        for (let attempt = 0; attempt < 8; attempt++) {
          const conflicts = placed.some((other) => {
            const longitudinal = Math.abs(raceMetres(other) - targetDistance);
            const lateral = Math.abs(other.laneOffset - working.laneOffset);
            return longitudinal < HARD_LONGITUDINAL_BUFFER && lateral < REQUIRED_LATERAL;
          });
          if (!conflicts) break;
          targetDistance -= HARD_LONGITUDINAL_BUFFER;
        }
        working = placeAtRaceMetres(working, Math.max(0, targetDistance));
      }
    }

    placed.push(working);
    const targetIndex = result.findIndex((candidate) => candidate.id === working.id);
    result[targetIndex] = working;
  }

  return result;
}

function raceMetres(driver: Pick<DriverState, 'lap' | 'progress'>): number {
  return raceDistance(driver.lap, driver.progress) * TRACK_LENGTH;
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
