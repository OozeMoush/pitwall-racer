const MAX_CANDIDATE_TRAFFIC_SECONDS = 1.5;
const DIRTY_AIR_THRESHOLD = 0.01;
const TRAFFIC_PRESSURE_THRESHOLD = 0.22;

/**
 * Pure tow is allowed: it changes straight-line pace slightly but does not
 * normally invalidate the demonstrated path. Dirty air and sustained nearby
 * pressure can alter braking/turn-in/line choice, so those remain disqualifying
 * when they shape a meaningful part of the lap.
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
    void tow;
    const trafficAffected = dirtyAir > DIRTY_AIR_THRESHOLD
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
