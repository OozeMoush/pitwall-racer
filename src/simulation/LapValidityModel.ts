import {
  WHEEL_CENTRES,
  WHEEL_HALF_LENGTH,
  WHEEL_HALF_WIDTH,
} from './CarGeometry';
import { TRACK_ROAD_HALF_WIDTH, trackRoadHalfWidth } from './TrackLimitsModel';
import { projectTrack } from './TrackModel';

// Track-limit legality follows the visible four-wheel envelope, not the smaller
// Rapier collider used to make wheel-to-wheel contact feel fair.
export const TRACK_LIMIT_HALF_LENGTH =
  Math.max(...WHEEL_CENTRES.map((wheel) => Math.abs(wheel.x)))
  + WHEEL_HALF_LENGTH;
export const TRACK_LIMIT_HALF_WIDTH =
  Math.max(...WHEEL_CENTRES.map((wheel) => Math.abs(wheel.y)))
  + WHEEL_HALF_WIDTH;

export interface LapValiditySnapshot {
  warnings: number;
  invalid: boolean;
  candidateEligible: boolean;
}

export type LapValidityEvent = 'NONE' | 'WARNING' | 'INVALIDATED';

const DEFAULT_WARNING_LIMIT = 3;

/**
 * Track limits are based on the visible tyre footprints, not the centre point
 * or the smaller Rapier contact collider. A warning is issued only when all
 * four tyres are completely beyond the same white line.
 */
export class LapValidityTracker {
  private warningCount = 0;
  private outside = false;
  private forcedInvalid = false;
  private pushSide = 0;
  private pushRemaining = 0;
  private exemptOutside = false;

  constructor(private readonly warningLimit = DEFAULT_WARNING_LIMIT) {}

  reset(preserveExcursion = false): void {
    this.warningCount = 0;
    if (!preserveExcursion) {
      this.outside = false;
      this.pushSide = 0;
      this.pushRemaining = 0;
      this.exemptOutside = false;
    }
    this.forcedInvalid = false;
  }

  /**
   * Local straight-road helper retained for focused model tests.
   * Runtime gameplay should use sampleWorld(), because each wheel can sit on a
   * different local road tangent in a tight miniature corner.
   */
  sample(
    laneOffset: number,
    trackHeading: number,
    vehicleHeading: number,
    dt = 0,
    lateralPush = 0,
  ): LapValidityEvent {
    return this.sampleOutside(isEntireCarBeyondTrack(
      laneOffset,
      trackHeading,
      vehicleHeading,
    ), Math.sign(laneOffset), dt, lateralPush);
  }

  /**
   * Exact runtime check: project each visible wheel at its own world position
   * so curved-road geometry cannot turn a legal kerb ride into a false warning.
   */
  sampleWorld(
    vehicleX: number,
    vehicleY: number,
    vehicleHeading: number,
    dt = 0,
    carPush = { x: 0, y: 0 },
  ): LapValidityEvent {
    const projection = projectTrack(vehicleX, vehicleY);
    const lateralPush = -Math.sin(projection.heading) * carPush.x
      + Math.cos(projection.heading) * carPush.y;
    return this.sampleOutside(isEntireCarBeyondTrackAt(
      vehicleX, vehicleY, vehicleHeading,
    ), Math.sign(projection.laneOffset), dt, lateralPush);
  }

  clearContactGrace(): void {
    this.pushSide = 0;
    this.pushRemaining = 0;
    this.exemptOutside = false;
  }

  invalidate(): void {
    this.forcedInvalid = true;
  }

  snapshot(): LapValiditySnapshot {
    return {
      warnings: this.warningCount,
      invalid: this.invalid,
      // A player trace is only a clean racing-line candidate if it never put
      // all four visible tyres outside the legal road and never needed recovery.
      candidateEligible: !this.forcedInvalid && this.warningCount === 0,
    };
  }

  get warnings(): number {
    return this.warningCount;
  }

  get invalid(): boolean {
    return this.forcedInvalid || this.warningCount >= this.warningLimit;
  }

  private sampleOutside(fullCarOutside: boolean, side: number, dt: number, lateralPush: number): LapValidityEvent {
    this.pushRemaining = Math.max(0, this.pushRemaining - Math.max(0, dt));
    // A car-only solver impulse must push toward the eventual exit. This is a
    // bounded causal approximation, not a decision about which driver is at fault.
    // No immunity can be acquired after the car has already left the road.
    if (!this.outside && Number.isFinite(lateralPush) && Math.abs(lateralPush) >= 0.3) {
      this.pushSide = Math.sign(lateralPush);
      this.pushRemaining = 0.75;
    }
    if (!fullCarOutside) {
      if (this.outside) { this.pushRemaining = 0; this.pushSide = 0; }
      this.outside = false;
      this.exemptOutside = false;
      return 'NONE';
    }
    if (this.outside) return 'NONE';
    this.outside = true;
    this.exemptOutside = this.pushRemaining > 0 && side === this.pushSide;
    this.pushRemaining = 0;
    if (this.exemptOutside) return 'NONE';
    this.warningCount += 1;
    return this.invalid ? 'INVALIDATED' : 'WARNING';
  }

}

/**
 * Analytic local-road check used by focused tests and simple callers.
 * This assumes a single road tangent under the whole car.
 */
export function isEntireCarBeyondTrack(
  laneOffset: number,
  trackHeading: number,
  vehicleHeading: number,
): boolean {
  const headingDelta = vehicleHeading - trackHeading;
  const sin = Math.sin(headingDelta);
  const cos = Math.cos(headingDelta);
  const wheelExtent =
    Math.abs(sin) * WHEEL_HALF_LENGTH
    + Math.abs(cos) * WHEEL_HALF_WIDTH;
  const wheelOffsets = WHEEL_CENTRES.map(
    (wheel) => laneOffset + wheel.x * sin + wheel.y * cos,
  );

  return wheelOffsets.every(
    (offset) => offset - wheelExtent > TRACK_ROAD_HALF_WIDTH,
  ) || wheelOffsets.every(
    (offset) => offset + wheelExtent < -TRACK_ROAD_HALF_WIDTH,
  );
}

/**
 * Curved-road runtime check. Each wheel centre is projected independently onto
 * the active circuit and its visible tyre footprint is tested against that
 * wheel's local white-line tangent.
 */
export function isEntireCarBeyondTrackAt(
  vehicleX: number,
  vehicleY: number,
  vehicleHeading: number,
): boolean {
  const cos = Math.cos(vehicleHeading);
  const sin = Math.sin(vehicleHeading);
  let allBeyondRight = true;
  let allBeyondLeft = true;

  for (const wheel of WHEEL_CENTRES) {
    const wheelX = vehicleX + wheel.x * cos - wheel.y * sin;
    const wheelY = vehicleY + wheel.x * sin + wheel.y * cos;
    const projection = projectTrack(wheelX, wheelY);
    const headingDelta = vehicleHeading - projection.heading;
    const lateralExtent =
      Math.abs(Math.sin(headingDelta)) * WHEEL_HALF_LENGTH
      + Math.abs(Math.cos(headingDelta)) * WHEEL_HALF_WIDTH;

    const roadHalfWidth = trackRoadHalfWidth(projection.progress);
    if (projection.laneOffset - lateralExtent <= roadHalfWidth) {
      allBeyondRight = false;
    }
    if (projection.laneOffset + lateralExtent >= -roadHalfWidth) {
      allBeyondLeft = false;
    }

    if (!allBeyondRight && !allBeyondLeft) return false;
  }

  return allBeyondRight || allBeyondLeft;
}
