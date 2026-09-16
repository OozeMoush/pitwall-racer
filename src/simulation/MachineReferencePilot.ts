import type { ArcadeCarInput } from './ArcadeCarController';
import { dynamicAiControl } from './DynamicAiController';
import type { MachineLapPolicyContext } from './MachineLapEvaluator';
import { createAiField, type DriverState } from './RaceModel';
import { compoundPeakGrip, createTire } from './TireModel';
import type { TrackId } from './TrackModel';

const POWER_BOOST = 0.22;
const GRIP = compoundPeakGrip('SOFT', 'PUSH');

/**
 * Diagnostic machine pilot that keeps the proven clean-air steering controller
 * while replacing its longitudinal policy with a simple executable speed loop.
 *
 * `speedScale` is not a production difficulty multiplier. It is a search axis
 * used to answer one question before line optimisation: how far can the current
 * machine-generated path exceed the old analytical speed envelope while the
 * shared chassis still completes a legal lap?
 */
export class MachineReferencePilot {
  private readonly driver: DriverState;

  constructor(
    private readonly trackId: TrackId,
    private readonly speedScale: number,
  ) {
    this.driver = createAiField()[0];
    this.driver.id = 'machine-reference';
    this.driver.name = 'MACHINE';
    this.driver.skill = 1.25; // referenceExecutionForSkill clamps to exactly 100%
    this.driver.progress = 0.08;
    this.driver.lap = 0;
    this.driver.laneOffset = 0;
    this.driver.speed = 0;
    this.driver.battleState = 'CLEAR';
    this.driver.tire = {
      ...createTire('SOFT'),
      grip: GRIP,
      wear: 0,
      temperature: 103,
    };
  }

  control(context: MachineLapPolicyContext): ArcadeCarInput {
    const speed = Math.hypot(context.state.vx, context.state.vy);
    this.driver.progress = context.projection.progress;
    this.driver.laneOffset = context.projection.laneOffset;
    this.driver.speed = speed;
    this.driver.lap = context.completedLaps;
    this.driver.battleState = 'CLEAR';

    const control = dynamicAiControl(this.driver, {
      x: context.state.x,
      y: context.state.y,
      heading: context.state.heading,
      speed,
      yawRate: context.state.yawRate,
    }, []);

    const targetSpeed = control.targetSpeed * this.speedScale;
    const speedError = targetSpeed - speed;
    const overspeed = -speedError;
    let throttle = 0;
    let brake = 0;

    if (overspeed > 0.45) {
      brake = clamp((overspeed - 0.25) / 9.5, 0.04, 1);
    } else if (speedError > 0.55) {
      throttle = 1;
    } else if (speedError > -0.45) {
      throttle = clamp(0.62 + speedError * 0.28, 0.48, 1);
    }

    return {
      throttle,
      brake,
      steer: control.steer,
      tireGrip: GRIP,
      surfaceGrip: 1,
      powerBoost: POWER_BOOST,
      powerMultiplier: 1,
      rollingResistance: 0,
    };
  }

  get requestedScale(): number {
    return this.speedScale;
  }

  get selectedTrack(): TrackId {
    return this.trackId;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
