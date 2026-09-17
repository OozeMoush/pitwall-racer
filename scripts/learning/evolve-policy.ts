import RAPIER from '@dimforge/rapier2d-compat';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  comparePitwallLearningResults,
  evaluatePitwallLearningPolicy,
  type PitwallLearningEpisodeResult,
} from '../../src/simulation/PitwallLearningEnvironment';
import {
  PitwallNeuralPolicy,
  type PitwallNeuralPolicyData,
} from '../../src/simulation/PitwallNeuralPolicy';

interface EvolutionOptions {
  input: string;
  output: string;
  generations: number;
  population: number;
  sigma: number;
  mutationRate: number;
  seed: number;
}

interface Candidate {
  parameters: number[];
  result: PitwallLearningEpisodeResult;
}

const options = parseOptions(process.argv.slice(2));
await RAPIER.init();

const inputData = JSON.parse(await readFile(options.input, 'utf8')) as PitwallNeuralPolicyData;
let incumbentPolicy = new PitwallNeuralPolicy(inputData);
let incumbent: Candidate = evaluate(incumbentPolicy.parameters());
let sigma = options.sigma;
const random = mulberry32(options.seed);

await mkdir(dirname(options.output), { recursive: true });
await saveCandidate(options.output, incumbent, {
  generation: 0,
  sigma,
  options,
});

console.log('LEARNING_EVOLUTION_START', JSON.stringify(summary(incumbent, 0, sigma)));

for (let generation = 1; generation <= options.generations; generation++) {
  const candidates: Candidate[] = [];
  const pairCount = Math.ceil(options.population / 2);

  for (let pair = 0; pair < pairCount; pair++) {
    const epsilon = incumbent.parameters.map(() => (
      random() < options.mutationRate ? normal(random) * sigma : 0
    ));
    for (const sign of [1, -1] as const) {
      if (candidates.length >= options.population) break;
      const parameters = incumbent.parameters.map((value, index) => value + sign * epsilon[index]);
      candidates.push(evaluate(parameters));
    }
  }

  candidates.sort((a, b) => comparePitwallLearningResults(a.result, b.result));
  const challenger = candidates[0];
  const improved = comparePitwallLearningResults(challenger.result, incumbent.result) < 0;

  if (improved) {
    incumbent = challenger;
    incumbentPolicy = incumbentPolicy.withParameters(incumbent.parameters);
    sigma = Math.min(0.08, sigma * 1.025);
    await saveCandidate(options.output, incumbent, {
      generation,
      sigma,
      options,
    });
  } else {
    sigma = Math.max(0.0015, sigma * 0.94);
  }

  const statuses = candidates.reduce((counts, candidate) => {
    counts[candidate.result.status] = (counts[candidate.result.status] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);

  console.log('LEARNING_EVOLUTION_GENERATION', JSON.stringify({
    ...summary(incumbent, generation, sigma),
    improved,
    populationStatuses: statuses,
    bestChallenger: compactResult(challenger.result),
  }));
}

console.log('LEARNING_EVOLUTION_DONE', JSON.stringify({
  output: options.output,
  ...summary(incumbent, options.generations, sigma),
}, null, 2));

function evaluate(parameters: readonly number[]): Candidate {
  const policy = incumbentPolicy.withParameters(parameters);
  const result = evaluatePitwallLearningPolicy(
    ({ observation }) => policy.act(observation),
    { captureFlyingLap: false },
  );
  return { parameters: [...parameters], result };
}

async function saveCandidate(
  output: string,
  candidate: Candidate,
  metadata: Record<string, unknown>,
): Promise<void> {
  const policy = incumbentPolicy.withParameters(candidate.parameters);
  await writeFile(output, `${JSON.stringify(policy.data, null, 2)}\n`, 'utf8');
  const meta = output.endsWith('.json') ? output.slice(0, -5) + '.meta.json' : `${output}.meta.json`;
  await writeFile(meta, `${JSON.stringify({
    ...metadata,
    result: compactResult(candidate.result),
    humanTelemetryUsed: false,
  }, null, 2)}\n`, 'utf8');
}

function compactResult(result: PitwallLearningEpisodeResult): Record<string, unknown> {
  return {
    status: result.status,
    invalidReason: result.invalidReason ?? null,
    lapSeconds: result.lapSeconds === undefined ? null : Number(result.lapSeconds.toFixed(3)),
    forwardProgressMetres: Number(result.forwardProgressMetres.toFixed(1)),
    maxLaneDistance: Number(result.maxLaneDistance.toFixed(3)),
    peakSlideSeverity: Number(result.peakSlideSeverity.toFixed(3)),
  };
}

function summary(candidate: Candidate, generation: number, currentSigma: number): Record<string, unknown> {
  return {
    generation,
    sigma: Number(currentSigma.toFixed(6)),
    ...compactResult(candidate.result),
  };
}

function parseOptions(args: string[]): EvolutionOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) continue;
    const [key, inline] = arg.split('=', 2);
    if (inline !== undefined) values.set(key, inline);
    else if (args[index + 1] && !args[index + 1].startsWith('--')) values.set(key, args[++index]);
    else values.set(key, 'true');
  }

  const input = resolve(values.get('--input') ?? 'artifacts/pitwall-learning/policy-teacher.json');
  const output = resolve(values.get('--output') ?? 'artifacts/pitwall-learning/policy-evolved.json');
  const generations = positiveInteger(values.get('--generations'), 80);
  const population = Math.max(2, positiveInteger(values.get('--population'), 20));
  const sigma = positiveNumber(values.get('--sigma'), 0.015);
  const mutationRate = clamp(positiveNumber(values.get('--mutation-rate'), 0.18), 0.01, 1);
  const seed = positiveInteger(values.get('--seed'), 56062);
  return { input, output, generations, population, sigma, mutationRate, seed };
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random: () => number): number {
  const u = Math.max(1e-12, random());
  const v = Math.max(1e-12, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
