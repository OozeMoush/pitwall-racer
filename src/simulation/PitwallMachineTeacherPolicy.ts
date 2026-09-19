import {
  createPitwallAbsolutePilot,
  createPitwallAbsolutePilotForLine,
  createPitwallAbsoluteSeed,
  type PitwallAbsoluteGenome,
} from './PitwallAbsoluteOptimizer';
import type {
  PitwallLearningPolicy,
  PitwallLearningPolicyContext,
} from './PitwallLearningEnvironment';
import { installReferenceLineCalibration } from './ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from './ReferenceTrajectoryData';

/**
 * Machine-only 25.458 s Rapier-verified controller exposed through the learning
 * environment policy interface. This is a seed/teacher only: optimized residual
 * traces can later be distilled into a standalone neural policy.
 */
export function createPitwallMachineTeacherPolicy(
  genome: PitwallAbsoluteGenome = createPitwallAbsoluteSeed(),
): PitwallLearningPolicy {
  installReferenceLineCalibration();
  return adaptTeacher(createPitwallAbsolutePilot(
    OPTIMIZED_REFERENCE_LANES['pitwall-gp'],
    genome,
  ));
}

export function createPitwallMachineTeacherPolicyForLine(
  lanes: readonly number[],
  genome: PitwallAbsoluteGenome = createPitwallAbsoluteSeed(),
  options: {
    laneTargetLimit?: number;
    laneResidual?: (progress: number) => number;
  } = {},
): PitwallLearningPolicy {
  installReferenceLineCalibration();
  return adaptTeacher(createPitwallAbsolutePilotForLine(
    lanes,
    genome,
    options,
  ));
}

function adaptTeacher(
  teacher: ReturnType<typeof createPitwallAbsolutePilot>,
): PitwallLearningPolicy {
  return (context: PitwallLearningPolicyContext) => {
    const speed = context.state.speed;
    const control = teacher.control({
      state: {
        x: context.state.x,
        y: context.state.y,
        heading: context.state.heading,
        // Preserve the already Rapier-validated teacher adapter. The learned
        // policy itself receives full planar velocity independently.
        vx: Math.cos(context.state.heading) * speed,
        vy: Math.sin(context.state.heading) * speed,
        yawRate: context.state.yawRate,
      },
      projection: context.projection,
      elapsedSeconds: context.elapsedSeconds,
      completedLaps: context.completedLaps,
    });

    return {
      steer: control.steer,
      throttle: control.throttle,
      brake: control.brake,
    };
  };
}
