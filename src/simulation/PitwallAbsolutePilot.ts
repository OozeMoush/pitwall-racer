import type { ArcadeCarInput } from './ArcadeCarController';
import { MachineLinePilot } from './MachineLinePilot';
import type { MachineLapPolicyContext } from './MachineLapEvaluator';
import {
  PITWALL_ABSOLUTE_PROFILE,
  samplePitwallAbsoluteProfile,
  type PitwallAbsoluteProfileSample,
} from './PitwallAbsoluteProfile';
import { compoundPeakGrip } from './TireModel';

const POWER_BOOST = 0.22;
const GRIP = compoundPeakGrip('SOFT', 'PUSH');

export interface PitwallAbsolutePilotOptions {
  profile?: readonly PitwallAbsoluteProfileSample[];
  predictionScale?: number;
  lookAheadScale?: number;
  /** Closed-loop correction strength around the machine-only feed-forward trace. */
  speedFeedback?: number;
}

/**
 * Pitwall longitudinal pilot that no longer uses ReferenceDriver target speed
 * or planned brake values.
 *
 * Steering is delegated to the already-proven machine line follower. Only its
 * `steer` output is consumed; throttle and brake come from the independent
 * machine-only Rapier trace plus a bounded speed-error correction. Power, tyre
 * grip and chassis inputs remain exactly the shared player-car values.
 */
export class PitwallAbsolutePilot {
  private readonly steeringPilot: MachineLinePilot;
  private readonly profile: readonly PitwallAbsoluteProfileSample[];
  private readonly speedFeedback: number;

  constructor(
    lanes: readonly number[],
    options: PitwallAbsolutePilotOptions = {},
  ) {
    this.profile = options.profile && options.profile.length > 1
      ? [...options.profile]
      : PITWALL_ABSOLUTE_PROFILE;
    this.speedFeedback = clamp(options.speedFeedback ?? 1, 0, 2);
    this.steeringPilot = new MachineLinePilot('pitwall-gp', lanes, {
      predictionScale: options.predictionScale ?? 0.10,
      lookAheadScale: options.lookAheadScale ?? 1,
    });
  }

  control(context: MachineLapPolicyContext): ArcadeCarInput {
    const speed = Math.hypot(context.state.vx, context.state.vy);
    const steeringSeed = this.steeringPilot.control(context);
    const target = sampleProfile(this.profile, context.projection.progress);
    const speedError = target.speed - speed;

    let throttle = target.throttle;
    let brake = target.brake;

    // Keep the measured legal control trace as the dominant feed-forward term.
    // Correction starts outside a small deadband and is deliberately bounded so
    // migration does not invent a new braking map before the optimizer owns it.
    if (speedError < -0.30) {
      const correction = clamp(((-speedError - 0.30) / 6.0) * this.speedFeedback, 0, 0.55);
      throttle *= 1 - correction;
      brake = Math.max(brake, correction);
    } else if (speedError > 0.30) {
      const correction = clamp(((speedError - 0.30) / 5.0) * this.speedFeedback, 0, 0.72);
      brake *= 1 - correction;
      throttle = Math.max(throttle, correction);
    }

    return {
      throttle: clamp(throttle, 0, 1),
      brake: clamp(brake, 0, 1),
      steer: steeringSeed.steer,
      tireGrip: GRIP,
      surfaceGrip: 1,
      powerBoost: POWER_BOOST,
      powerMultiplier: 1,
      rollingResistance: 0,
    };
  }
}

function sampleProfile(
  profile: readonly PitwallAbsoluteProfileSample[],
  progress: number,
): PitwallAbsoluteProfileSample {
  if (profile === PITWALL_ABSOLUTE_PROFILE) return samplePitwallAbsoluteProfile(progress);
  const p = ((progress % 1) + 1) % 1;
  const scaled = p * profile.length;
  const index = Math.floor(scaled) % profile.length;
  const next = (index + 1) % profile.length;
  const t = scaled - Math.floor(scaled);
  const a = profile[index];
  const b = profile[next];
  return {
    speed: lerp(a.speed, b.speed, t),
    throttle: lerp(a.throttle, b.throttle, t),
    brake: lerp(a.brake, b.brake, t),
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
