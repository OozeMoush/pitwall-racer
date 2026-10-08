import { activeReferenceTarget } from '../RacingLineRuntime';
import { getActiveTrack, sampleTrack, TRACK_LENGTH } from '../TrackModel';
import { trackAiSafeLaneLimit } from '../TrackLimitsModel';
import type { VehicleState } from '../VehicleModel';
import type { PassingInput, PassingPhase } from './PairPassing';

/** Second isolated candidate: merge relative to the moving reference path. */
export class CorridorPassing {
  private phase: PassingPhase = 'FOLLOW';
  private offset: number | undefined;
  private side = -1;
  private age = 0;
  private cooldown = 0;
  private settled = 0;

  step(input: PassingInput, car: VehicleState, progress: number, grip: number) {
    const reference = input.referenceLane;
    const dt = clamp(input.dt, 0, 1 / 30);
    this.offset ??= input.lane - reference;
    this.age += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const gap = input.gap;
    if (this.phase === 'FOLLOW' && this.cooldown === 0 && input.straight
      && gap > 25 && gap < 65 && input.speed > input.opponentSpeed + 2) {
      const sides = [-1, 1].filter(side => Math.abs(input.opponentLane + side * 7) < input.safeLane - 1);
      sides.sort((a, b) => Math.abs(input.opponentLane + a * 7 - input.lane)
        - Math.abs(input.opponentLane + b * 7 - input.lane));
      if (sides.length) { this.side = sides[0]; this.phase = 'COMMIT'; this.age = 0; }
    }
    if (this.phase === 'COMMIT' && Math.abs(gap) < 18) this.phase = 'ALONGSIDE';
    if (this.phase === 'COMMIT' || this.phase === 'ALONGSIDE') {
      if (gap < -18) this.phase = 'RETURN';
      else if (this.age > 10 || (!input.straight && gap > 18)
        || Math.abs(input.opponentLane + this.side * 7) > input.safeLane - 1) this.phase = 'ABORT';
    }
    if (this.phase === 'ABORT' && gap > 25) this.phase = 'RETURN';
    const relativeSpeed = input.opponentSpeed - input.speed;
    const futureGap = gap + relativeSpeed * 3;
    const mergeClear = Math.abs(gap) > 22 && Math.abs(futureGap) > 22 && gap * futureGap > 0;
    // A rival catching a returning car reserves the side it physically occupies,
    // not the side chosen before a partially completed crossing.
    if (this.phase === 'RETURN' && !mergeClear) this.side = input.lane >= input.opponentLane ? 1 : -1;
    const desired = this.phase === 'FOLLOW' || (this.phase === 'RETURN' && mergeClear)
      ? 0 : input.opponentLane + this.side * 7 - reference;
    this.offset += clamp(desired - this.offset, -2.5 * dt, 2.5 * dt);
    const aligned = this.phase === 'RETURN' && mergeClear && Math.abs(this.offset) < 0.25
      && Math.abs(input.lane - reference) < 1
      && Math.abs(wrap(car.heading - sampleTrack(progress).heading)) < 0.2;
    this.settled = aligned ? this.settled + dt : 0;
    if (this.settled >= 0.35) {
      this.phase = 'FOLLOW'; this.cooldown = 3;
    }
    let speedCap = this.phase === 'ABORT' ? Math.max(0, input.opponentSpeed - 8) : Infinity;
    if (gap > 0 && Math.abs(input.lane - input.opponentLane) < 6.5) {
      speedCap = Math.min(speedCap, Math.max(0, input.opponentSpeed + (gap - 22) * 0.5));
    }
    const plan = { phase: this.phase, speedCap };
    const offset = this.offset;
    const point = (metres: number) => {
      const p = progress + metres / TRACK_LENGTH;
      const line = activeReferenceTarget(getActiveTrack().id, p, grip);
      const limit = trackAiSafeLaneLimit(p) - 1;
      const lane = clamp(line.laneOffset + offset, -limit, limit);
      return { ...sampleTrack(p, lane), speed: line.targetSpeed };
    };
    const lookahead = clamp(18 + car.speed * 0.25, 25, 42);
    const target = point(lookahead);
    const tangent = point(lookahead + 8);
    const heading = Math.atan2(tangent.y - target.y, tangent.x - target.x);
    const bearing = Math.atan2(target.y - car.y, target.x - car.x);
    const steer = clamp(wrap(heading - car.heading) * 2.15
      + wrap(bearing - car.heading) * 0.82
      + clamp((reference + offset - input.lane) / 9, -1, 1) * 0.52
      - car.yawRate * 0.38, -0.98, 0.98);
    // Fixed-size preview of candidate curvature. Braking allowance is applied
    // backwards from each future sample, rather than waiting for corner entry.
    let speed = Math.min(plan.speedCap, point(0).speed);
    for (const metres of [15, 30, 60, 90, 120]) {
      const a = point(metres - 8), b = point(metres), c = point(metres + 8);
      const ab = Math.hypot(b.x - a.x, b.y - a.y);
      const bc = Math.hypot(c.x - b.x, c.y - b.y);
      const ac = Math.hypot(c.x - a.x, c.y - a.y);
      const curvature = 2 * Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
        / Math.max(1e-6, ab * bc * ac);
      const cornerSpeed = Math.min(b.speed * 0.98, Math.sqrt(40 / Math.max(curvature, 0.001)));
      speed = Math.min(speed, Math.sqrt(cornerSpeed ** 2 + 2 * 16 * Math.max(0, metres - 15)));
    }
    return { ...plan, lane: offset + reference, steer, speed };
  }
}
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function wrap(v: number) { return Math.atan2(Math.sin(v), Math.cos(v)); }
