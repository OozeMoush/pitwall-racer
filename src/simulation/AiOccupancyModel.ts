import type { DriverState } from './RaceModel';
import { raceDistance } from './RaceModel';
import { TRACK_LENGTH } from './TrackModel';

const LANE_OPTIONS = [-48, -24, 0, 24, 48] as const;
const CONFLICT_LONGITUDINAL = 74;
const REQUIRED_LATERAL = 20;
const HARD_LONGITUDINAL_BUFFER = 42;

/**
 * Lightweight race-game occupancy resolver for the abstract AI field.
 *
 * Cars are smaller in the current 3D scale and the road is wide enough for more
 * than three usable lines. Giving the pack five occupancy lanes prevents the
 * old behaviour where everyone immediately queued into a single artificial
 * train. If all lanes are genuinely occupied, the next car forms another row.
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
        .map((candidate) => clamp(candidate, -50, 50))
        .sort((a, b) => Math.abs(a - working.laneOffset) - Math.abs(b - working.laneOffset));
      const freeLane = candidates.find((candidate) => nearbyAhead.every((other) => Math.abs(candidate - other.laneOffset) >= REQUIRED_LATERAL));

      if (freeLane !== undefined) {
        working.laneOffset = freeLane;
      } else {
        const rearmost = Math.min(...nearbyAhead.map(raceMetres));
        let targetDistance = rearmost - HARD_LONGITUDINAL_BUFFER;

        for (let attempt = 0; attempt < 10; attempt++) {
          const conflicts = placed.some((other) => {
            const longitudinal = Math.abs(raceMetres(other) - targetDistance);
            const lateral = Math.abs(other.laneOffset - working.laneOffset);
            return longitudinal < HARD_LONGITUDINAL_BUFFER && lateral < REQUIRED_LATERAL;
          });
          if (!conflicts) break;
          targetDistance -= HARD_LONGITUDINAL_BUFFER;
        }

        working.speed = Math.min(working.speed, Math.min(...nearbyAhead.map((other) => other.speed)) + 1.5);
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
  // raceDistance is now lap + progress because lap 0 represents the physical
  // grid before the start line. Inverting it therefore uses floor(normalized)
  // directly; the old +1 would silently jump an occupancy-adjusted car a lap.
  const lap = Math.floor(normalized);
  return {
    ...driver,
    lap,
    progress: normalized - lap,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
