import RAPIER from '@dimforge/rapier2d-compat';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  comparePitwallLearningResults,
  evaluatePitwallLearningPolicy,
  type PitwallLearningEpisodeResult,
} from '../../src/simulation/PitwallLearningEnvironment';
import {
  createPitwallAbsoluteSeed,
  materializePitwallAbsoluteLine,
} from '../../src/simulation/PitwallAbsoluteOptimizer';
import {
  createPitwallMachineTeacherPolicyForLine,
} from '../../src/simulation/PitwallMachineTeacherPolicy';
import {
  applyPitwallResidual,
  validatePitwallResidualPolicyData,
  type PitwallResidualPolicyData,
} from '../../src/simulation/PitwallResidualPolicy';
import {
  applyPitwallFineResidual,
  validatePitwallFineResidualPolicyData,
  type PitwallFineResidualPolicyData,
} from '../../src/simulation/PitwallFineResidualPolicy';
import {
  createPitwallLineResidualPolicyData,
  lineResidualDataWithParameters,
  samplePitwallLineResidual,
  validatePitwallLineResidualPolicyData,
  type PitwallLineResidualPolicyData,
} from '../../src/simulation/PitwallLineResidualPolicy';
import { OPTIMIZED_REFERENCE_LANES } from '../../src/simulation/ReferenceTrajectoryData';
import { TRACK_BARRIER_OFFSET } from '../../src/simulation/TrackLimitsModel';

interface SearchOptions {
  coarse: string;
  fine: string;
  input?: string;
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
  direction: number;
}

const options = parseOptions(process.argv.slice(2));
await RAPIER.init();

const coarseResidual = await loadJson<PitwallResidualPolicyData>(
  options.coarse,
  validatePitwallResidualPolicyData,
);
const fineResidual = await loadJson<PitwallFineResidualPolicyData>(
  options.fine,
  validatePitwallFineResidualPolicyData,
);
const lineTemplate = options.input
  ? await loadJson<PitwallLineResidualPolicyData>(
      options.input,
      validatePitwallLineResidualPolicyData,
    )
  : createPitwallLineResidualPolicyData();

const absoluteGenome = createPitwallAbsoluteSeed();
const baseLanes = materializePitwallAbsoluteLine(
  OPTIMIZED_REFERENCE_LANES['pitwall-gp'],
  absoluteGenome,
);

let incumbent = evaluate(lineTemplate.parameters);
if (incumbent.result.status !== 'COMPLETED') {
  throw new Error(
    `Line-search baseline must complete a valid lap; got ${incumbent.result.status} ${incumbent.result.invalidReason ?? ''}`,
  );
}

let sigma = options.sigma;
let stagnantGenerations = 0;
const random = mulberry32(options.seed);
let coordinateOrder = shuffledIndices(lineTemplate.parameters.length, random);
let coordinateCursor = 0;
let coordinateCycle = 1;

await mkdir(dirname(options.output), { recursive: true });
await saveCandidate(options.output, incumbent, 0, sigma);

console.log('LINE_RESIDUAL_SEARCH_START', JSON.stringify({
  ...summary(incumbent, 0, sigma),
  parameterCount: incumbent.parameters.length,
  laneScale: lineTemplate.laneScale,
  activeParametersPerDirection: 1,
  algorithm: 'line-coordinate-cycle-antithetic-trust-region',
  coordinateCycle,
  coarsePolicy: options.coarse,
  finePolicy: options.fine,
  resumedFrom: options.input ?? null,
  artificialReferenceLaneClamp: false,
}));

for (let generation = 1; generation <= options.generations; generation++) {
  const candidates: PerturbedCandidate[] = [];
  const pairCount = options.population / 2;

  for (let pair = 0; pair < pairCount; pair++) {
    if (coordinateCursor >= coordinateOrder.length) {
      coordinateOrder = shuffledIndices(lineTemplate.parameters.length, random);
      coordinateCursor = 0;
      coordinateCycle += 1;
    }

    const parameterIndex = coordinateOrder[coordinateCursor++];
    const magnitude = clamp(Math.abs(normal(random)), 0.35, 1.75);

    for (const sign of [1, -1] as const) {
      const parameters = [...incumbent.parameters];
      parameters[parameterIndex] += sign * sigma * magnitude;
      candidates.push({
        ...evaluate(parameters),
        knot: parameterIndex,
        direction: sign * magnitude,
      });
    }
  }

  candidates.sort((a, b) => comparePitwallLearningResults(a.result, b.result));
  const populationBest = candidates[0];
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

  if (completedFraction === 0) {
    sigma *= 0.60;
  } else if (completedFraction < 0.5) {
    sigma *= 0.82;
  } else if (improved && completedFraction >= 0.8) {
    sigma *= 1.035;
  } else if (stagnantGenerations >= 6) {
    sigma *= 0.82;
  } else {
    sigma *= options.sigmaDecay;
  }
  sigma = clamp(sigma, 0.005, 0.35);

  const statuses = candidates.reduce((counts, candidate) => {
    counts[candidate.result.status] = (counts[candidate.result.status] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);

  console.log('LINE_RESIDUAL_SEARCH_GENERATION', JSON.stringify({
    ...summary(incumbent, generation, sigma),
    improved,
    completedFraction: Number(completedFraction.toFixed(3)),
    populationStatuses: statuses,
    coordinateCycle,
    coordinatesVisitedInCycle: coordinateCursor,
    populationBest: {
      ...compactResult(populationBest.result),
      knot: populationBest.knot,
      direction: Number(populationBest.direction.toFixed(3)),
      approximateLaneDeltaMetres: Number(
        (lineTemplate.laneScale * Math.tanh(
          sigma * populationBest.direction,
        )).toFixed(3),
      ),
    },
  }));
}

console.log('LINE_RESIDUAL_SEARCH_DONE', JSON.stringify({
  output: options.output,
  ...summary(incumbent, options.generations, sigma),
  coordinateCycle,
  coordinatesVisitedInCycle: coordinateCursor,
  maxAbsoluteLaneResidualMetres: Number(
    maxAbsoluteLaneResidual(incumbent.parameters, lineTemplate.laneScale).toFixed(3),
  ),
}, null, 2));

function evaluate(parameters: readonly number[]): Candidate {
  const lineResidual = lineResidualDataWithParameters(lineTemplate, parameters);
  const teacher = createPitwallMachineTeacherPolicyForLine(
    baseLanes,
    absoluteGenome,
    {
      laneTargetLimit: TRACK_BARRIER_OFFSET - 0.25,
      laneResidual: (progress) => samplePitwallLineResidual(lineResidual, progress),
    },
  );

  const result = evaluatePitwallLearningPolicy(
    (context) => {
      const coarseAction = applyPitwallResidual(
        teacher(context),
        context.projection.progress,
        coarseResidual,
      );
      return applyPitwallFineResidual(
        coarseAction,
        context.projection.progress,
        fineResidual,
      );
    },
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
  const lineResidual = lineResidualDataWithParameters(lineTemplate, candidate.parameters);
  await writeFile(output, `${JSON.stringify(lineResidual, null, 2)}\n`, 'utf8');
  const meta = output.endsWith('.json')
    ? output.slice(0, -5) + '.meta.json'
    : `${output}.meta.json`;
  await writeFile(meta, `${JSON.stringify({
    basePolicy: 'machine-only-pitwall-absolute-seed',
    coarsePolicy: options.coarse,
    finePolicy: options.fine,
    resumedFrom: options.input ?? null,
    generation,
    sigma: currentSigma,
    result: compactResult(candidate.result),
    maxAbsoluteLaneResidualMetres: maxAbsoluteLaneResidual(
      candidate.parameters,
      lineTemplate.laneScale,
    ),
    algorithm: 'line-coordinate-cycle-antithetic-trust-region',
    artificialReferenceLaneClamp: false,
    humanTelemetryUsed: false,
  }, null, 2)}\n`, 'utf8');
}

async function loadJson<T>(
  path: string,
  validate: (data: T) => void,
): Promise<T> {
  const data = JSON.parse(await readFile(path, 'utf8')) as T;
  validate(data);
  return data;
}

function compactResult(result: PitwallLearningEpisodeResult): Record<string, unknown> {
  return {
    status: result.status,
    invalidReason: result.invalidReason ?? null,
    lapSeconds: result.lapSeconds === undefined ? null : Number(result.lapSeconds.toFixed(3)),
    preciseLapSeconds: result.preciseLapSeconds === undefined
      ? null
      : Number(result.preciseLapSeconds.toFixed(6)),
    forwardProgressMetres: Number(result.forwardProgressMetres.toFixed(1)),
    maxLaneDistance: Number(result.maxLaneDistance.toFixed(3)),
    peakSlideSeverity: Number(result.peakSlideSeverity.toFixed(3)),
  };
}

function summary(
  candidate: Candidate,
  generation: number,
  currentSigma: number,
): Record<string, unknown> {
  return {
    generation,
    sigma: Number(currentSigma.toFixed(6)),
    ...compactResult(candidate.result),
  };
}

function maxAbsoluteLaneResidual(
  parameters: readonly number[],
  laneScale: number,
): number {
  return Math.max(0, ...parameters.map(
    (parameter) => Math.abs(laneScale * Math.tanh(parameter)),
  ));
}

function shuffledIndices(length: number, random: () => number): number[] {
  const values = Array.from({ length }, (_, index) => index);
  for (let index = values.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}

function parseOptions(args: string[]): SearchOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith('--')) continue;
    const [key, inline] = arg.split('=', 2);
    if (inline !== undefined) values.set(key, inline);
    else if (args[index + 1] && !args[index + 1].startsWith('--')) {
      values.set(key, args[++index]);
    } else {
      values.set(key, 'true');
    }
  }

  const coarseRaw = values.get('--coarse');
  const fineRaw = values.get('--fine');
  if (!coarseRaw) throw new Error('--coarse is required');
  if (!fineRaw) throw new Error('--fine is required');

  const inputRaw = values.get('--input');
  const requestedPopulation = Math.max(6, positiveInteger(values.get('--population'), 24));
  return {
    coarse: resolve(coarseRaw),
    fine: resolve(fineRaw),
    input: inputRaw ? resolve(inputRaw) : undefined,
    output: resolve(
      values.get('--output') ?? 'artifacts/pitwall-learning/policy-line-residual.json',
    ),
    generations: positiveInteger(values.get('--generations'), 8),
    population: requestedPopulation % 2 === 0
      ? requestedPopulation
      : requestedPopulation + 1,
    sigma: positiveNumber(values.get('--sigma'), 0.08),
    sigmaDecay: clamp(positiveNumber(values.get('--sigma-decay'), 0.995), 0.90, 1),
    seed: positiveInteger(values.get('--seed'), 56065),
  };
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
