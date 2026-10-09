import { activeReferenceTarget } from '../RacingLineRuntime';
import { getActiveTrack, sampleTrack, TRACK_LENGTH } from '../TrackModel';
import { trackAiSafeLaneLimit } from '../TrackLimitsModel';
import type { VehicleState } from '../VehicleModel';
import type { PassingInput, PassingPhase } from './PairPassing';

/** Defensive racecraft candidate. Isolated two-car lab only; prior policies stay intact. */
export class DefensePassing {
  private phase: PassingPhase = 'FOLLOW';
  private offset: number | undefined;
  private side = -1;
  private age = 0;
  private cooldown = 0;
  private settled = 0;
  private blocked = 0;
  private clearingStop = false;
  private committedOffset = 0;
  private previousOpponentLane: number | undefined;
  private reason = 'following';
  private retreating = false;
  private mistakeAttack = false;

  step(input: PassingInput, car: VehicleState, progress: number, grip: number) {
    const reference = input.referenceLane;
    const dt = clamp(input.dt, 0, 1 / 30);
    this.offset ??= input.lane - reference;
    this.age += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const gap = input.gap;
    const opponentRate = this.previousOpponentLane === undefined || dt === 0 ? 0
      : clamp((input.opponentLane - reference - this.previousOpponentLane) / dt, -8, 8);
    this.previousOpponentLane = input.opponentLane - reference;
    this.reason = this.phase === 'FOLLOW' ? 'following' : this.reason;
    const slowObstacle = input.opponentSpeed < 3 && input.speed < 12 && gap > 20 && gap < 65;
    this.blocked = this.phase === 'FOLLOW' && slowObstacle ? this.blocked + dt : 0;
    if (this.phase === 'FOLLOW' && Math.abs(gap) < 12 && Math.abs(input.lane - input.opponentLane) > 5.5) {
      this.side = input.lane > input.opponentLane ? 1 : -1;
      this.committedOffset = input.lane - reference;
      this.phase = 'ALONGSIDE'; this.age = 0; this.reason = 'existing overlap';
    }
    const mistake = input.speed > input.opponentSpeed + 15 && input.opponentSpeed < 50;
    const normalAttack = gap > 20 && gap < 65 && input.speed > input.opponentSpeed + 2;
    const stoppedAttack = this.blocked >= 0.6;
    const launchSpace = [60, 120, 180].every(m => Math.abs(wrap(
      sampleTrack(progress + m / TRACK_LENGTH).heading - sampleTrack(progress).heading)) < 0.12);
    if (this.phase === 'FOLLOW' && this.cooldown === 0 && input.straight && launchSpace
      && (normalAttack || stoppedAttack)) {
      const sides = [-1, 1].filter(side => {
        const offset = input.opponentLane + side * 7 - reference;
        return [0, 30, 60, 90, 120].every(m => {
          const p = progress + m / TRACK_LENGTH;
          return Math.abs(activeReferenceTarget(getActiveTrack().id, p, grip).laneOffset + offset)
            < Math.min(input.safeLane, trackAiSafeLaneLimit(p)) - 1;
        });
      });
      const turn = wrap(sampleTrack(progress + 250 / TRACK_LENGTH).heading - sampleTrack(progress).heading);
      // Prefer the outside of the approaching bend for a clear slowing mistake.
      const outside = -Math.sign(turn);
      sides.sort((a, b) => (input.opponentSpeed < input.speed - 15 && Math.abs(turn) > 0.2
        ? (a === outside ? -1 : 1) - (b === outside ? -1 : 1) : 0) || Math.abs(input.opponentLane + a * 7 - input.lane)
        - Math.abs(input.opponentLane + b * 7 - input.lane));
      if (sides.length) {
        this.side = sides[0];
        this.committedOffset = input.opponentLane + this.side * 7 - reference;
        this.reason = 'open corridor'; this.retreating = false; this.phase = 'COMMIT'; this.age = 0;
        this.clearingStop = stoppedAttack; this.mistakeAttack = mistake;
      }
    }
    if ((this.phase === 'COMMIT' || this.phase === 'ALONGSIDE') && slowObstacle) this.clearingStop = true;
    // A defender moving into the chosen corridor before body overlap wins it.
    // Do not move the target another seven metres away and continue the attack.
    const corridorLane = reference + this.committedOffset;
    const predictedOpponent = input.opponentLane + opponentRate * 0.6;
    const closesCorridor = Math.abs(input.opponentLane - corridorLane) < 5.8
      || (opponentRate * this.side > 0.4 && Math.abs(predictedOpponent - corridorLane) < 6.3);
    if (this.phase === 'COMMIT' && gap > 12 && closesCorridor) {
      this.phase = 'ABORT'; this.retreating = true; this.reason = 'early defence';
    }
    // Proximity alone is not alongside: the physical lanes must be separated.
    if (this.phase === 'COMMIT' && Math.abs(gap) < 12
      && Math.abs(input.lane - input.opponentLane) > 5.5) {
      this.phase = 'ALONGSIDE'; this.reason = 'space reserved';
    }
    if (this.phase === 'COMMIT' || this.phase === 'ALONGSIDE') {
      if (gap < -18) this.phase = 'RETURN';
      else if (this.age > (this.clearingStop ? 20 : 10) || (!input.straight && !this.mistakeAttack && gap > 18)
        || Math.abs(reference + this.committedOffset) > input.safeLane - 1) {
        this.phase = 'ABORT'; this.retreating = true; this.reason = 'corner or timeout';
      }
    }
    if (this.phase === 'ABORT' && gap > 30 && input.speed <= input.opponentSpeed) this.phase = 'RETURN';
    const relativeSpeed = input.opponentSpeed - input.speed;
    const futureGap = gap + relativeSpeed * 3;
    const mergeClear = Math.abs(gap) > 22 && Math.abs(futureGap) > 22 && gap * futureGap > 0;
    // A rival catching a returning car reserves the side it physically occupies,
    // not the side chosen before a partially completed crossing.
    if (this.phase === 'RETURN' && !mergeClear) {
      this.committedOffset = input.lane - reference;
    }
    let desired = this.phase === 'FOLLOW' || (this.phase === 'RETURN' && mergeClear)
      ? 0 : this.committedOffset;
    // Hold the established physical side; a squeeze can require longitudinal
    // yielding, but cannot command a crossing through the opponent.
    if ((this.phase === 'ALONGSIDE' || this.phase === 'ABORT') && Math.abs(gap) <= 22) {
      const occupiedSide = input.lane >= input.opponentLane ? 1 : -1;
      desired = occupiedSide > 0 ? Math.max(desired, input.opponentLane + 7 - reference)
        : Math.min(desired, input.opponentLane - 7 - reference);
      desired = clamp(desired, -input.safeLane + 1 - reference, input.safeLane - 1 - reference);
    }
    this.offset += clamp(desired - this.offset, -2.5 * dt, 2.5 * dt);
    const aligned = this.phase === 'RETURN' && mergeClear && Math.abs(this.offset) < 0.25
      && Math.abs(input.lane - reference) < 1
      && Math.abs(wrap(car.heading - sampleTrack(progress).heading)) < 0.2;
    this.settled = aligned ? this.settled + dt : 0;
    if (this.settled >= 0.35) {
      this.phase = 'FOLLOW'; this.cooldown = 3; this.clearingStop = false; this.retreating = false; this.reason = 'reconsider after cooldown';
    }
    let speedCap = this.retreating && this.phase !== 'FOLLOW' ? Math.max(0, input.opponentSpeed - 8) : Infinity;
    const lowSpeedAligned = this.clearingStop && input.opponentSpeed < 3
      && Math.abs(wrap(car.heading - sampleTrack(progress).heading)) < 0.25;
    if (gap > 0 && Math.abs(input.lane - input.opponentLane) < (lowSpeedAligned ? 6 : 6.5)) {
      // A stopped pair needs forward motion to steer. Creep only while the
      // committed bypass still has longitudinal room; retain the normal buffer
      // for FOLLOW, ABORT and ordinary high-speed attacks.
      const creeping = this.clearingStop && input.opponentSpeed < 3
        && (this.phase === 'COMMIT' || this.phase === 'ALONGSIDE');
      const buffer = creeping ? Math.max(5, 10 - Math.abs(input.lane - input.opponentLane) * 0.75) : 22;
      const followingCap = Math.max(0, input.opponentSpeed + (gap - buffer) * 0.5);
      speedCap = Math.min(speedCap, creeping ? Math.min(3, followingCap) : followingCap);
    }
    const plan = { phase: this.phase, speedCap, reason: this.reason };
    const offset = this.offset;
    const point = (metres: number) => {
      const p = progress + metres / TRACK_LENGTH;
      const line = activeReferenceTarget(getActiveTrack().id, p, grip);
      const limit = trackAiSafeLaneLimit(p) - 1;
      const lane = clamp(line.laneOffset + offset, -limit, limit);
      return { ...sampleTrack(p, lane), speed: line.targetSpeed };
    };
    const lookahead = this.clearingStop && car.speed < 12
      ? clamp(5 + car.speed * 0.5, 5, 11) : clamp(18 + car.speed * 0.25, 25, 42);
    const target = point(lookahead);
    const tangent = point(lookahead + 8);
    const heading = Math.atan2(tangent.y - target.y, tangent.x - target.x);
    const bearing = Math.atan2(target.y - car.y, target.x - car.x);
    const steer = this.clearingStop && car.speed < 12
      ? clamp(wrap(bearing - car.heading) * 2.5 - car.yawRate * 0.38, -0.98, 0.98)
      : clamp(wrap(heading - car.heading) * 2.15
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
    return { ...plan, lane: offset + reference, steer, speed,
      referenceSteering: this.phase === 'FOLLOW' || (this.phase === 'RETURN' && mergeClear && Math.abs(offset) < 0.25) };
  }
}
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function wrap(v: number) { return Math.atan2(Math.sin(v), Math.cos(v)); }
