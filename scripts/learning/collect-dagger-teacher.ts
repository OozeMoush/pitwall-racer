import RAPIER from '@dimforge/rapier2d-compat';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PitwallLearningStepEnvironment } from '../../src/simulation/PitwallLearningStepEnvironment';
import { createPitwallMachineTeacherPolicy } from '../../src/simulation/PitwallMachineTeacherPolicy';
import {
  PitwallSacPolicy,
  type PitwallSacPolicyData,
} from '../../src/simulation/PitwallSacPolicy';

interface Options {
  actor: string;
  output: string;
  episodes: number;
  learnerProbability: number;
  seed: number;
}

const options = parseOptions(process.argv.slice(2));
await RAPIER.init();

const actorData = JSON.parse(
  await readFile(options.actor, 'utf8'),
) as PitwallSacPolicyData;
const actor = new PitwallSacPolicy(actorData);
const random = mulberry32(options.seed);
const rows: string[] = [];
const episodeSummaries: Array<Record<string, unknown>> = [];

for (let episode = 0; episode < options.episodes; episode++) {
  const environment = new PitwallLearningStepEnvironment({
    maximumSeconds: 70,
  });
  const teacher = createPitwallMachineTeacherPolicy();
  let context = environment.reset();
  let samples = 0;

  while (true) {
    const teacherAction = teacher(context);
    rows.push(JSON.stringify({
      observation: [...context.observation],
      action: [
        teacherAction.steer,
        teacherAction.throttle,
        teacherAction.brake,
      ],
    }));
    samples += 1;

    const learnerAction = actor.act(context.observation);
    const behaviorAction =
      random() < options.learnerProbability
        ? learnerAction
        : teacherAction;
    const transition = environment.step(behaviorAction);

    if (transition.result) {
      episodeSummaries.push({
        episode,
        samples,
        learnerProbability: options.learnerProbability,
        behaviorStatus: transition.result.status,
        invalidReason: transition.result.invalidReason ?? null,
        forwardProgressMetres: Number(
          transition.result.forwardProgressMetres.toFixed(1),
        ),
        elapsedSeconds: Number(
          transition.result.elapsedSeconds.toFixed(3),
        ),
      });
      break;
    }
    context = transition.context;
  }
}

await mkdir(dirname(options.output), { recursive: true });
await writeFile(
  options.output,
  rows.length > 0 ? `${rows.join('\n')}\n` : '',
  'utf8',
);

console.log(JSON.stringify({
  output: options.output,
  samples: rows.length,
  episodes: options.episodes,
  learnerProbability: options.learnerProbability,
  episodeSummaries,
}, null, 2));

function parseOptions(args: string[]): Options {
  const values = new Map<string, string>();
  const positional: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [key, inline] = arg.split('=', 2);
    if (inline !== undefined) values.set(key, inline);
    else if (args[index + 1] && !args[index + 1].startsWith('--')) {
      values.set(key, args[++index]);
    } else {
      values.set(key, 'true');
    }
  }

  const actorRaw = values.get('--actor') ?? positional[0];
  const outputRaw = values.get('--output') ?? positional[1];
  if (!actorRaw) throw new Error('--actor is required');
  if (!outputRaw) throw new Error('--output is required');

  return {
    actor: resolve(actorRaw),
    output: resolve(outputRaw),
    episodes: positiveInteger(values.get('--episodes'), 4),
    learnerProbability: clamp(
      finiteNumber(values.get('--learner-probability'), 0.5),
      0,
      1,
    ),
    seed: positiveInteger(values.get('--seed'), 56069),
  };
}

function positiveInteger(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteNumber(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function mulberry32(seedValue: number): () => number {
  let value = seedValue >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
