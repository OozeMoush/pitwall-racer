import { getActiveTrack, setActiveTrack } from './TrackModel';
import type { PitwallLearningAction } from './PitwallNeuralPolicy';
import {
  PitwallLearningStepEnvironment,
  pitwallLearningObservation,
  type PitwallLearningEpisodeOptions,
  type PitwallLearningEpisodeResult,
  type PitwallLearningInvalidReason,
  type PitwallLearningPolicyContext,
  type PitwallLearningStatus,
  type PitwallLearningTraceSample,
} from './PitwallLearningStepEnvironment';

export {
  PitwallLearningStepEnvironment,
  pitwallLearningObservation,
  type PitwallLearningEpisodeOptions,
  type PitwallLearningEpisodeResult,
  type PitwallLearningInvalidReason,
  type PitwallLearningPolicyContext,
  type PitwallLearningStatus,
  type PitwallLearningTraceSample,
} from './PitwallLearningStepEnvironment';

export type PitwallLearningPolicy = (
  context: PitwallLearningPolicyContext,
) => PitwallLearningAction;

/**
 * Run one complete Pitwall learning episode in the same stepwise environment
 * used by RL. This wrapper preserves the original policy-evaluation API so all
 * existing teacher/checkpoint regressions remain authoritative.
 */
export function evaluatePitwallLearningPolicy(
  policy: PitwallLearningPolicy,
  options: PitwallLearningEpisodeOptions = {},
): PitwallLearningEpisodeResult {
  const previousTrack = getActiveTrack().id;
  setActiveTrack('pitwall-gp');

  try {
    const environment = new PitwallLearningStepEnvironment(options);
    let context = environment.context();

    while (true) {
      const transition = environment.step(policy(context));
      if (transition.result) return transition.result;
      context = transition.context;
    }
  } finally {
    setActiveTrack(previousTrack);
  }
}

/**
 * Compare episode results without inventing a numeric off-track penalty.
 * Completed valid laps dominate everything and are ordered solely by lap time.
 * Incomplete episodes dominate invalid ones and are ordered by forward progress.
 */
export function comparePitwallLearningResults(
  a: PitwallLearningEpisodeResult,
  b: PitwallLearningEpisodeResult,
): number {
  const tier = (result: PitwallLearningEpisodeResult) =>
    result.status === 'COMPLETED'
      ? 2
      : result.status === 'INCOMPLETE'
        ? 1
        : 0;
  const tierDelta = tier(b) - tier(a);
  if (tierDelta !== 0) return tierDelta;

  if (a.status === 'COMPLETED' && b.status === 'COMPLETED') {
    // The actual 120 Hz game-equivalent result is authoritative. Sub-tick
    // interpolation is only a tie-breaker inside the same game-time bucket.
    const gameDelta =
      (a.lapSeconds ?? Infinity) - (b.lapSeconds ?? Infinity);
    if (gameDelta !== 0) return gameDelta;
    const aPrecise =
      a.preciseLapSeconds ?? a.lapSeconds ?? Infinity;
    const bPrecise =
      b.preciseLapSeconds ?? b.lapSeconds ?? Infinity;
    return aPrecise - bPrecise;
  }

  return b.forwardProgressMetres - a.forwardProgressMetres;
}
