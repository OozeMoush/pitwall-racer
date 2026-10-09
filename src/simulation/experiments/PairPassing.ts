/** Issue #153 research only. No production caller; one same-lap AUTO pair. */
export type PassingPhase = 'FOLLOW' | 'COMMIT' | 'ALONGSIDE' | 'ABORT' | 'RETURN';
export interface PassingInput {
  dt: number;
  gap: number; // opponent minus ego, metres along the circuit
  speed: number;
  opponentSpeed: number;
  lane: number;
  opponentLane: number;
  referenceLane: number;
  safeLane: number; // minimum road envelope over the next 120 metres
  straight: boolean;
}

const SEPARATION = 7;
const CLEARANCE = 18;
const LATERAL_RATE = 2.5;

export class PairPassing {
  phase: PassingPhase = 'FOLLOW';
  lane: number | undefined;
  private side = 1;
  private elapsed = 0;
  private cooldown = 0;

  step(input: PassingInput): { phase: PassingPhase; lane: number; speedCap: number } {
    const i = input;
    const dt = Math.max(0, Math.min(i.dt, 1 / 30));
    this.lane ??= i.lane;
    this.elapsed += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.phase === 'FOLLOW' && this.cooldown === 0 && i.straight
      && i.gap > 22 && i.gap < 65 && i.speed > i.opponentSpeed + 2) {
      // Pick once. Never reverse side while committed.
      const candidates = [-1, 1].filter(side =>
        Math.abs(i.opponentLane + side * SEPARATION) < i.safeLane);
      candidates.sort((a, b) => Math.abs(i.opponentLane + a * SEPARATION - i.lane)
        - Math.abs(i.opponentLane + b * SEPARATION - i.lane));
      if (candidates.length) {
        this.side = candidates[0];
        this.phase = 'COMMIT';
        this.elapsed = 0;
      }
    }
    if (this.phase === 'COMMIT' && Math.abs(i.gap) < CLEARANCE) this.phase = 'ALONGSIDE';
    if ((this.phase === 'COMMIT' || this.phase === 'ALONGSIDE') && i.gap < -CLEARANCE) {
      this.phase = 'RETURN';
    }
    if ((this.phase === 'COMMIT' || this.phase === 'ALONGSIDE')
      && (this.elapsed > 6 || (!i.straight && i.gap > CLEARANCE)
        || Math.abs(i.opponentLane + this.side * SEPARATION) > i.safeLane)) {
      this.phase = 'ABORT';
    }
    if (this.phase === 'ABORT' && i.gap > CLEARANCE) this.phase = 'RETURN';
    // A returning rival can close the gap again. Reserve its space until clear.
    const overlapping = Math.abs(i.gap) <= CLEARANCE;
    let desired = this.phase === 'FOLLOW' || (this.phase === 'RETURN' && !overlapping)
      ? i.referenceLane : i.opponentLane + this.side * SEPARATION;
    desired = clamp(desired, -i.safeLane, i.safeLane);
    this.lane += clamp(desired - this.lane, -LATERAL_RATE * dt, LATERAL_RATE * dt);
    if (this.phase === 'RETURN' && !overlapping
      && Math.abs(this.lane - i.referenceLane) < 0.25 && Math.abs(i.lane - i.referenceLane) < 1) {
      this.phase = 'FOLLOW';
      this.cooldown = 3;
    }
    let speedCap = Infinity;
    if (this.phase === 'ABORT') speedCap = Math.max(0, i.opponentSpeed - 8);
    // Do not close while the physical car is still moving into the passing lane.
    if (i.gap > 0 && Math.abs(i.lane - i.opponentLane) < SEPARATION - 0.5) {
      speedCap = Math.min(speedCap, Math.max(0, i.opponentSpeed + (i.gap - 22) * 0.5));
    }
    return { phase: this.phase, lane: this.lane, speedCap };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
