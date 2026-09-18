import RAPIER from '@dimforge/rapier2d-compat';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  comparePitwallLearningResults,
  evaluatePitwallLearningPolicy,
  type PitwallLearningEpisodeResult,
} from '../../src/simulation/PitwallLearningEnvironment';
import { createPitwallMachineTeacherPolicy } from '../../src/simulation/PitwallMachineTeacherPolicy';
import {
  applyPitwallResidual,
  createPitwallResidualPolicyData,
  PITWALL_RESIDUAL_CHANNELS,
  PITWALL_RESIDUAL_KNOTS,
  residualDataWithParameters,
} from '../../src/simulation/PitwallResidualPolicy';

interface SearchOptions {
  output: string;
  generations: number;
  population: number;
  sigma: number;
  sigmaDecay: number;
  seed: number;
}

interface Candidate {
  parameters: number[];
  result: PitwallLearningEpisodeResult;
}

interface PerturbedCandidate extends Candidate {
  knot: number;
  channel: number;
  direction: number;
}

const options = parseOptions(process.argv.slice(2));
await RAPIER.init();

const basePolicy = createPitwallMachineTeacherPolicy();
const residualTemplate = createPitwallResidualPolicyData();
let incumbent = evaluate(residualTemplate.parameters);
if (incumbent.result.status !== 'COMPLETED') {
  throw new Error(
    `Machine teacher must complete a valid lap; got ${incumbent.result.status} ${incumbent.result.invalidReason ?? ''}`,
  );
}

let sigma = options.sigma;
let stagnantGenerations = 0;
const random = mulberry32(options.seed);
let coordinateOrder = shuffledIndices(residualTemplate.parameters.length, random);
let coordinateCursor = 0;
let coordinateCycle = 1;

await mkdir(dirname(options.output), { recursive: true });
await saveCandidate(options.output, incumbent, 0, sigma);

console.log('SPARSE_RESIDUAL_SEARCH_START', JSON.stringify({
  ...summary(incumbent, 0, sigma),
  parameterCount: incumbent.parameters.length,
  activeParametersPerDirection: 1,
  algorithm: 'coordinate-cycle-antithetic-trust-region',
  coordinateCycle,
}));

for (let generation = 1; generation <= options.generations; generation++) {
  const candidates: PerturbedCandidate[] = [];
  const pairCount = options.population / 2;

  // Each antithetic pair changes exactly one local actuator knot. Coordinates
  // are visited without replacement so a long run covers all 32 x 3 controls
  // before spending budget on repeats. The order is reshuffled between cycles.
  for (let pair = 0; pair < pairCount; pair++) {
    if (coordinateCursor >= coordinateOrder.length) {
      coordinateOrder = shuffledIndices(residualTemplate.parameters.length, random);
      coordinateCursor = 0;
      coordinateCycle += 1;
    }
    const parameterIndex = coordinateOrder[coordinateCursor++];
    const knot = Math.floor(parameterIndex / PITWALL_RESIDUAL_CHANNELS);
    const channel = parameterIndex % PITWALL_RESIDUAL_CHANNELS;
    const magnitude = clamp(Math.abs(normal(random)), 0.35, 1.75);

    for (const sign of [1, -1] as const) {
      const parameters = [...incumbent.parameters];
      parameters[parameterIndex] += sign * sigma * magnitude;
      candidates.push({
        ...evaluate(parameters),
        knot,
        channel,
        direction: sign * magnitude,
      });
    }
  }

  const ranked = [...candidates].sort(
    (a, b) => comparePitwallLearningResults(a.result, b.result),
  );
  const populationBest = ranked[0];
  const completedCount = candidates.filter(
    (candidate) => candidate.result.status === 'COMPLETED',
  ).length;
  const completedFraction = completedCount / candidates.length;

  let improved = false;
  if (populationBest.result.status === 'COMPLETED'
    && comparePitwallLearningResults(populationBest.result, incumbent.result) < 0) {
    incumbent = {
      parameters: [...populationBest.parameters],
      result: populationBest.result,
    };
    improved = true;
    stagnantGenerations = 0;
    await saveCandidate(options.output, incumbent, generation, sigma);
  } else {
    stagnantGenerations += 1;
  }

  // Trust-region adaptation uses only physical validity/improvement rates. It
  // does not assign a numeric reward penalty to grass or invalid laps.
  if (completedFraction === 0) {
    sigma *= 0.60;
  } else if (completedFraction < 0.5) {
    sigma *= 0.82;
  } else if (improved && completedFraction >= 0.8) {
    sigma *= 1.04;
  } else if (stagnantGenerations >= 8) {
    sigma *= 0.85;
  } else {
    sigma *= options.sigmaDecay;
  }
  sigma = clamp(sigma, 0.005, 0.35);

  const statuses = candidates.reduce((counts, candidate) => {
    counts[candidate.result.status] = (counts[candidate.result.status] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);

  console.log('SPARSE_RESIDUAL_SEARCH_GENERATION', JSON.stringify({
    ...summary(incumbent, generation, sigma),
    improved,
    completedFraction: Number(completedFraction.toFixed(3)),
    populationStatuses: statuses,
    coordinateCycle,
    coordinatesVisitedInCycle: coordinateCursor,
    populationBest: {
      ...compactResult(populationBest.result),
      knot: populationBest.knot,
      channel: channelName(populationBest.channel),
      direction: Number(populationBest.direction.toFixed(3)),
    },
  }));
}

console.log('SPARSE_RESIDUAL_SEARCH_DONE', JSON.stringify({
  output: options.output,
  ...summary(incumbent, options.generations, sigma),
}, null, 2));

function evaluate(parameters: readonly number[]): Candidate {
  const residual = residualDataWithParameters(residualTemplate, parameters);
  const result = evaluatePitwallLearningPolicy(
    (context) => applyPitwallResidual(
      basePolicy(context),
      context.projection.progress,
      residual,
    ),
    { captureFlyingLap: false },
  );
  return { parameters: [...parameters], result };
}

async function saveCandidate(
  output: string,
  candidate: Candidate,
  generation: number,
  currentSigma: number,
): Promise<void> {
  const residual = residualDataWithParameters(residualTemplate, candidate.parameters);
  await writeFile(output, `${JSON.stringify(residual, null, 2)}\n`, 'utf8');
  const meta = output.endsWith('.json') ? output.slice(0, -5) + '.meta.json' : `${output}.meta.json`;
  await writeFile(meta, `${JSON.stringify({
    basePolicy: 'machine-only-pitwall-absolute-seed',
    generation,
    sigma: currentSigma,
    result: compactResult(candidate.result),
    algorithm: 'coordinate-cycle-antithetic-trust-region',
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

function shuffledIndices(length: number, random: () => number): number[] {
  const values = Array.from({ length }, (_, index) => index);
  for (let index = values.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}

function channelName(channel: number): string {
  return ['steer', 'throttle', 'brake'][channel] ?? `channel-${channel}`;
}

function parseOptions(args: string[]): SearchOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) continue;
    const [key, inline] = arg.split('=', 2);
    if (inline !== undefined) values.set(key, inline);
    else if (args[index + 1] && !args[index + 1].startsWith('--')) values.set(key, args[++index]);
    else values.set(key, 'true');
  }

  const output = resolve(values.get('--output') ?? 'artifacts/pitwall-learning/policy-residual.json');
  const generations = positiveInteger(values.get('--generations'), 80);
  const requestedPopulation = Math.max(6, positiveInteger(values.get('--population'), 24));
  const population = requestedPopulation % 2 === 0 ? requestedPopulation : requestedPopulation + 1;
  const sigma = positiveNumber(values.get('--sigma'), 0.08);
  const sigmaDecay = clamp(positiveNumber(values.get('--sigma-decay'), 0.995), 0.90, 1);
  const seed = positiveInteger(values.get('--seed'), 56062);
  return { output, generations, population, sigma, sigmaDecay, seed };
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
