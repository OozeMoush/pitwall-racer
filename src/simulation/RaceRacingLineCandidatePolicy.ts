import { referenceTarget } from './ReferenceDriverModel';
import type { TrackId } from './TrackModel';

const MAX_CANDIDATE_TRAFFIC_SECONDS = 1.5;
const TOW_THRESHOLD = 0.02;
const DIRTY_AIR_THRESHOLD = 0.01;
const TRAFFIC_PRESSURE_THRESHOLD = 0.22;

/**
 * A race lap may briefly cross another car's wake without becoming useless as
 * a reference. Sustained tow/follow/side-by-side running is different: that
 * trajectory is traffic-dependent, so it must not replace the clean CPU line.
 */
export class RaceRacingLineCandidateFilter {
  private trafficSeconds = 0;

  reset(): void {
    this.trafficSeconds = 0;
  }

  sampleTraffic(
    dt: number,
    tow: number,
    dirtyAir: number,
    trafficPressure: number,
  ): void {
    const trafficAffected = tow > TOW_THRESHOLD
      || dirtyAir > DIRTY_AIR_THRESHOLD
      || trafficPressure > TRAFFIC_PRESSURE_THRESHOLD;
    if (trafficAffected) this.trafficSeconds += Math.max(0, dt);
  }

  get eligible(): boolean {
    return this.trafficSeconds <= MAX_CANDIDATE_TRAFFIC_SECONDS;
  }

  get affectedSeconds(): number {
    return this.trafficSeconds;
  }
}

/**
 * Store race-lap speed as if it had been driven at the lap-start grip.
 *
 * A Medium/Hard or worn-tyre lap can therefore contribute its line and pace
 * quality without baking that exact tyre state into the reusable PLAYER asset.
 */
export function normalizedRaceCandidateSpeed(
  trackId: TrackId,
  progress: number,
  actualSpeed: number,
  currentGrip: number,
  referenceGrip: number,
): number {
  const currentReference = referenceTarget(trackId, progress, currentGrip).targetSpeed;
  const storedReference = referenceTarget(trackId, progress, referenceGrip).targetSpeed;
  if (currentReference <= 1 || storedReference <= 1) return Math.max(0, actualSpeed);
  return Math.max(0, actualSpeed) * storedReference / currentReference;
}
