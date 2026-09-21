import {
  CAR_COLLIDER_HALF_LENGTH,
  CAR_COLLIDER_HALF_WIDTH,
} from './RapierRacePhysics';
import { TRACK_ROAD_HALF_WIDTH } from './TrackLimitsModel';

export interface LapValiditySnapshot {
  warnings: number;
  invalid: boolean;
  candidateEligible: boolean;
}

export type LapValidityEvent = 'NONE' | 'WARNING' | 'INVALIDATED';

const DEFAULT_WARNING_LIMIT = 3;

/**
 * Track limits are based on the physical car footprint, not its centre point.
 * A warning is issued only when the complete rectangular car is beyond one
 * side of the white-line road envelope.
 */
export class LapValidityTracker {
  private warningCount = 0;
  private outside = false;
  private forcedInvalid = false;

  constructor(private readonly warningLimit = DEFAULT_WARNING_LIMIT) {}

  reset(): void {
    this.warningCount = 0;
    this.outside = false;
    this.forcedInvalid = false;
  }

  sample(
    laneOffset: number,
    trackHeading: number,
    vehicleHeading: number,
  ): LapValidityEvent {
    const fullCarOutside = isEntireCarBeyondTrack(
      laneOffset,
      trackHeading,
      vehicleHeading,
    );

    if (!fullCarOutside) {
      this.outside = false;
      return 'NONE';
    }

    if (this.outside) return 'NONE';
    this.outside = true;
    this.warningCount += 1;
    return this.invalid ? 'INVALIDATED' : 'WARNING';
  }

  invalidate(): void {
    this.forcedInvalid = true;
  }

  snapshot(): LapValiditySnapshot {
    return {
      warnings: this.warningCount,
      invalid: this.invalid,
      // A player trace is only a clean racing-line candidate if it never put
      // the complete car outside the legal road and never needed recovery.
      candidateEligible: !this.forcedInvalid && this.warningCount === 0,
    };
  }

  get warnings(): number {
    return this.warningCount;
  }

  get invalid(): boolean {
    return this.forcedInvalid || this.warningCount >= this.warningLimit;
  }
}

export function isEntireCarBeyondTrack(
  laneOffset: number,
  trackHeading: number,
  vehicleHeading: number,
): boolean {
  const headingDelta = vehicleHeading - trackHeading;
  const lateralHalfExtent =
    Math.abs(Math.sin(headingDelta)) * CAR_COLLIDER_HALF_LENGTH
    + Math.abs(Math.cos(headingDelta)) * CAR_COLLIDER_HALF_WIDTH;

  return Math.abs(laneOffset) - lateralHalfExtent > TRACK_ROAD_HALF_WIDTH;
}
