import RAPIER from '@dimforge/rapier2d-compat';
import { createInterface } from 'node:readline';
import { MACHINE_PHYSICS_DT } from '../../src/simulation/MachineCarIntegrator';
import {
  PitwallLearningStepEnvironment,
  PITWALL_RL_REWARD_METRES_SCALE,
  type PitwallLearningEpisodeResult,
} from '../../src/simulation/PitwallLearningStepEnvironment';
import {
  PITWALL_LEARNING_ACTION_SIZE,
  PITWALL_LEARNING_OBSERVATION_SIZE,
  type PitwallLearningAction,
} from '../../src/simulation/PitwallNeuralPolicy';
import { setActiveTrack } from '../../src/simulation/TrackModel';

interface StepRequest {
  op: 'step';
  actions: number[][];
}

interface ResetRequest {
  op: 'reset';
}

interface CloseRequest {
  op: 'close';
}

type Request = StepRequest | ResetRequest | CloseRequest;

const envCount = parsePositiveInteger(process.argv.slice(2), '--envs', 16);

await RAPIER.init();
setActiveTrack('pitwall-gp');

const environments = Array.from(
  { length: envCount },
  () => new PitwallLearningStepEnvironment(),
);
let contexts = environments.map((environment) => environment.context());

write({
  type: 'ready',
  envs: envCount,
  observationSize: PITWALL_LEARNING_OBSERVATION_SIZE,
  actionSize: PITWALL_LEARNING_ACTION_SIZE,
  dt: MACHINE_PHYSICS_DT,
  rewardMetresScale: PITWALL_RL_REWARD_METRES_SCALE,
  observations: contexts.map((context) => [...context.observation]),
});

const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

for await (const line of input) {
  if (!line.trim()) continue;

  try {
    const request = JSON.parse(line) as Request;
    if (request.op === 'close') {
      write({ type: 'closed' });
      break;
    }

    if (request.op === 'reset') {
      contexts = environments.map((environment) => environment.reset());
      write({
        type: 'reset',
        observations: contexts.map((context) => [...context.observation]),
      });
      continue;
    }

    if (request.op !== 'step') {
      throw new Error('Unsupported RL server operation');
    }
    if (
      !Array.isArray(request.actions)
      || request.actions.length !== envCount
    ) {
      throw new Error(
        `Expected ${envCount} action vectors, got ${request.actions?.length ?? 0}`,
      );
    }

    const observations: number[][] = [];
    const rewards: number[] = [];
    const terminated: boolean[] = [];
    const truncated: boolean[] = [];
    const infos: Array<Record<string, unknown> | null> = [];

    for (let index = 0; index < envCount; index++) {
      const action = normalizedToPhysicalAction(request.actions[index]);
      const transition = environments[index].step(action);
      const episodeResult = transition.result;

      rewards.push(transition.reward);
      terminated.push(transition.terminated);
      truncated.push(transition.truncated);
      infos.push(
        episodeResult
          ? episodeInfo(episodeResult)
          : null,
      );

      if (transition.terminated || transition.truncated) {
        contexts[index] = environments[index].reset();
      } else {
        contexts[index] = transition.context;
      }
      observations.push([...contexts[index].observation]);
    }

    write({
      type: 'step',
      observations,
      rewards,
      terminated,
      truncated,
      infos,
    });
  } catch (error) {
    write({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function normalizedToPhysicalAction(
  values: readonly number[],
): PitwallLearningAction {
  if (values.length !== PITWALL_LEARNING_ACTION_SIZE) {
    throw new Error(
      `Expected ${PITWALL_LEARNING_ACTION_SIZE} action values, got ${values.length}`,
    );
  }
  const steer = clampFinite(values[0], -1, 1);
  const throttleNormalized = clampFinite(values[1], -1, 1);
  const brakeNormalized = clampFinite(values[2], -1, 1);
  return {
    steer,
    throttle: (throttleNormalized + 1) * 0.5,
    brake: (brakeNormalized + 1) * 0.5,
  };
}

function episodeInfo(
  result: PitwallLearningEpisodeResult,
): Record<string, unknown> {
  return {
    status: result.status,
    invalidReason: result.invalidReason ?? null,
    lapSeconds: result.lapSeconds ?? null,
    preciseLapSeconds: result.preciseLapSeconds ?? null,
    elapsedSeconds: result.elapsedSeconds,
    forwardProgressMetres: result.forwardProgressMetres,
    maxLaneDistance: result.maxLaneDistance,
    peakSlideSeverity: result.peakSlideSeverity,
  };
}

function write(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function parsePositiveInteger(
  args: readonly string[],
  key: string,
  fallback: number,
): number {
  const direct = args.find((arg) => arg.startsWith(`${key}=`));
  if (direct) {
    const parsed = Number.parseInt(direct.slice(key.length + 1), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
  const index = args.indexOf(key);
  if (index >= 0 && args[index + 1]) {
    const parsed = Number.parseInt(args[index + 1], 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
  return fallback;
}

function clampFinite(
  value: number | undefined,
  min: number,
  max: number,
): number {
  const finite = Number.isFinite(value) ? Number(value) : 0;
  return Math.max(min, Math.min(max, finite));
}
