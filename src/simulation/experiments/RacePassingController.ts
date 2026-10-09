import { aiEffectiveGrip, type DynamicAiControl } from '../DynamicAiController';
import type { DriverState, RaceTrafficCar } from '../RaceModel';
import { activeReferenceTarget, runtimeRacingLine } from '../RacingLineRuntime';
import { getActiveTrack, projectTrackNear, sampleTrack, TRACK_LENGTH } from '../TrackModel';
import { trackAiSafeLaneLimit, trackRoadHalfWidth } from '../TrackLimitsModel';
import type { VehicleState } from '../VehicleModel';
import { DefensePassing } from './DefensePassing';
import type { PassingPhase } from './PairPassing';

/** Opt-in GP adapter. Collision, chassis, tyre, aero and pit truth stay in Rapier. */
export class RacePassingController {
  private policy = new DefensePassing();
  private rivalId?: string;
  private phase: PassingPhase = 'FOLLOW';
  private lane?: number;
  private reason = 'following';
  private fingerprint?: unknown;

  reset(): void {
    this.policy = new DefensePassing(); this.rivalId = undefined;
    this.phase = 'FOLLOW'; this.lane = undefined; this.reason = 'following';
  }
  snapshot() { return { phase: this.phase, rivalId: this.rivalId, lane: this.lane, reason: this.reason }; }

  control(driver: DriverState, car: VehicleState, traffic: readonly RaceTrafficCar[],
    base: DynamicAiControl, dt: number): DynamicAiControl {
    const track = getActiveTrack();
    const line = runtimeRacingLine(track.id);
    if (track.id !== 'pitwall-gp' || line?.source === 'PLAYER' || line?.source === 'EDITOR') {
      this.reset(); return base;
    }
    if (line !== this.fingerprint) { this.reset(); this.fingerprint = line; }
    const projection = projectTrackNear(car.x, car.y, driver.progress);
    const gapTo = (other: RaceTrafficCar) => physicalTrafficGap(projection.progress, other.progress);
    const others = traffic.filter(other => other.id !== driver.id && Math.abs(other.laneOffset) < trackRoadHalfWidth(other.progress) + 3);
    let rival = this.phase !== 'FOLLOW' ? others.find(other => other.id === this.rivalId) : undefined;
    if (!rival) {
      // Preserve a corridor until the return settles. A vanished/pitting rival
      // uses a virtual far-clear obstacle rather than switching to another car.
      if (this.phase !== 'FOLLOW') rival = { id: this.rivalId ?? 'departed', lap: driver.lap,
        progress: projection.progress + 150 / TRACK_LENGTH, laneOffset: 0,
        speed: car.speed + 8, performance: 1 };
      else rival = others.filter(other => gapTo(other) > -12 && gapTo(other) < 80)
        .sort((a, b) => Math.abs(gapTo(a)) - Math.abs(gapTo(b)))[0];
    }
    // Grid launch stays on the established controller; the pair policy's
    // existing-overlap entry is intended for cars already at racing speed.
    if (!rival || (this.phase === 'FOLLOW' && car.speed < 25)) { return base; }
    this.rivalId = rival.id;
    const grip = aiEffectiveGrip(driver);
    const reference = activeReferenceTarget(track.id, projection.progress, grip);
    const reservesLane = (lane: number) => others.some(other => {
      if (other.id === rival!.id) return false;
      const gap = gapTo(other);
      const futureGap = gap + (other.speed - car.speed) * 1.5;
      return Math.min(gap, futureGap) < 100 && Math.max(gap, futureGap) > -25
        && Math.abs(other.laneOffset - lane) < 6.5;
    });
    const mergeBlocked = others.some(other => {
      if (other.id === rival!.id) return false;
      const gap = gapTo(other), futureGap = gap + (other.speed - car.speed) * 1.5;
      return Math.min(gap, futureGap) < 30 && Math.max(gap, futureGap) > -30
        && other.laneOffset > Math.min(projection.laneOffset, reference.laneOffset) - 6.5
        && other.laneOffset < Math.max(projection.laneOffset, reference.laneOffset) + 6.5;
    });
    const blockedSides = [-1, 1].filter(side => reservesLane(rival!.laneOffset + side * 7));
    const currentReferenceLane = reference.laneOffset;
    const aheadHeading = sampleTrack(projection.progress + 120 / TRACK_LENGTH).heading;
    const heading = sampleTrack(projection.progress).heading;
    const plan = this.policy.step({ dt, gap: gapTo(rival), speed: car.speed,
      opponentSpeed: rival.speed, lane: projection.laneOffset, opponentLane: rival.laneOffset,
      referenceLane: currentReferenceLane,
      safeLane: Math.min(...[0, 30, 60, 90, 120].map(m => trackAiSafeLaneLimit(projection.progress + m / TRACK_LENGTH))),
      straight: Math.abs(Math.atan2(Math.sin(aheadHeading - heading), Math.cos(aheadHeading - heading))) < 0.12,
      blockedSides, mergeBlocked, abortRequested: this.phase !== 'FOLLOW' && this.lane !== undefined && reservesLane(this.lane),
    }, car, projection.progress, grip);
    this.phase = plan.phase; this.lane = plan.lane; this.reason = plan.reason;
    if (plan.phase === 'FOLLOW' && plan.speed >= base.targetSpeed) return base;
    const targetSpeed = plan.phase === 'FOLLOW' ? Math.min(base.targetSpeed, plan.speed) : plan.speed;
    return { ...base, targetSpeed, targetLane: plan.referenceSteering ? base.targetLane : plan.lane,
      throttle: car.speed < targetSpeed ? 1 : 0,
      brake: Math.max(0, Math.min(1, (car.speed - targetSpeed) / 8)),
      steer: plan.referenceSteering ? base.steer : plan.steer,
      battleState: 'FOLLOW' };
  }
}

/** Physical neighbours include lapped cars; classification laps never hide a body. */
export function physicalTrafficGap(egoProgress: number, otherProgress: number): number {
  return (((otherProgress - egoProgress + 0.5) % 1 + 1) % 1 - 0.5) * TRACK_LENGTH;
}
