import RAPIER from '@dimforge/rapier2d-compat';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  comparePitwallLearningResults,
  evaluatePitwallLearningPolicy,
  type PitwallLearningEpisodeResult,
} from '../../src/simulation/PitwallLearningEnvironment';
import {
  adamAscent,
  centeredRankUtilities,
  createAdamAscentState,
  type AdamAscentState,
} from '../../src/simulation/PitwallEvolutionStrategy';
import {
  PitwallNeuralPolicy,
  type PitwallNeuralPolicyData,
} from '../../src/simulation/PitwallNeuralPolicy';
import {
  applyPitwallResidual,
  createPitwallResidualPolicyData,
  residualDataWithParameters,
  type PitwallResidualPolicyData,
} from '../../src/simulation/PitwallResidualPolicy';

interface EvolutionOptions {
  input: string;
  output: string;
  generations: number;
  population: number;
  sigma: number;
  learningRate: number;
  sigmaDecay: number;
  seed: number;
}

interface Candidate {
  parameters: number[];
  result: PitwallLearningEpisodeResult;
}

interface PerturbedCandidate extends Candidate {
  noise: number[];
}

const options = parseOptions(process.argv.slice(2));
await RAPIER.init();

const baseData = JSON.parse(await readFile(options.input, 'utf8')) as PitwallNeuralPolicyData;
const basePolicy = new PitwallNeuralPolicy(baseData);
const residualTemplate = createPitwallResidualPolicyData();

let meanParameters = [...residualTemplate.parameters];
let best = evaluate(meanParameters);
if (best.result.status !== 'COMPLETED') {
  throw new Error(
    `Residual base policy must complete a valid lap; got ${best.result.status} ${best.result.invalidReason ?? ''}`,
  );
}

let sigma = options.sigma;
let adamState = createAdamAscentState(meanParameters.length);
let stagnantGenerations = 0;
const random = mulberry32(options.seed);

await mkdir(dirname(options.output), { recursive: true });
await saveCandidate(options.output, best, 0, sigma);

console.log('RESIDUAL_EVOLUTION_START', JSON.stringify({
  ...summary(best, 0, sigma),
  parameterCount: meanParameters.length,
  algorithm: 'bounded-residual-rank-es-adam',
}));

for (let generation = 1; generation <= options.generations; generation++) {
  const candidates: PerturbedCandidate[] = [];
  const pairCount = options.population / 2;

  for (let pair = 0; pair < pairCount; pair++) {
    const direction = meanParameters.map(() => normal(random));
    for (const sign of [1, -1] as const) {
      const signedNoise = direction.map((value) => value * sign);
      const parameters = meanParameters.map(
        (value, index) => value + sigma * signedNoise[index],
      );
      candidates.push({ ...evaluate(parameters), noise: signedNoise });
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
    && comparePitwallLearningResults(populationBest.result, best.result) < 0) {
    best = {
      parameters: [...populationBest.parameters],
      result: populationBest.result,
    };
    meanParameters = [...best.parameters];
    adamState = createAdamAscentState(meanParameters.length);
    stagnantGenerations = 0;
    improved = true;
    await saveCandidate(options.output, best, generation, sigma);
  }

  let center = evaluate(meanParameters);
  let updateAccepted = false;
  let gradientNorm = 0;

  const enoughCompleted = completedCount >= Math.max(4, Math.ceil(candidates.length * 0.5));
  if (!improved && enoughCompleted) {
    const utilities = centeredRankUtilities(
      candidates,
      (a, b) => comparePitwallLearningResults(a.result, b.result),
    );
    const gradient = new Array<number>(meanParameters.length).fill(0);

    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
      const utility = utilities[candidateIndex];
      const noise = candidates[candidateIndex].noise;
      for (let parameterIndex = 0; parameterIndex < gradient.length; parameterIndex++) {
        gradient[parameterIndex] += utility * noise[parameterIndex];
      }
    }

    const scale = 1 / Math.max(1e-9, candidates.length * sigma);
    for (let index = 0; index < gradient.length; index++) gradient[index] *= scale;
    gradientNorm = Math.sqrt(gradient.reduce((sum, value) => sum + value * value, 0));

    const proposedAdam = cloneAdamState(adamState);
    const proposedParameters = adamAscent(
      meanParameters,
      gradient,
      proposedAdam,
      options.learningRate,
    );
    const proposedCenter = evaluate(proposedParameters);

    if (proposedCenter.result.status === 'COMPLETED') {
      meanParameters = proposedParameters;
      adamState = proposedAdam;
      center = proposedCenter;
      updateAccepted = true;

      if (comparePitwallLearningResults(center.result, best.result) < 0) {
        best = {
          parameters: [...center.parameters],
          result: center.result,
        };
        stagnantGenerations = 0;
        improved = true;
        await saveCandidate(options.output, best, generation, sigma);
      }
    }
  }

  if (!improved) stagnantGenerations += 1;

  if (completedFraction < 0.25) {
    sigma *= 0.65;
  } else if (completedFraction < 0.50) {
    sigma *= 0.82;
  } else if (completedFraction > 0.85 && updateAccepted) {
    sigma *= 1.01;
  } else {
    sigma *= options.sigmaDecay;
  }
  sigma = clamp(sigma, 0.005, 0.35);

  if (stagnantGenerations >= 12) {
    meanParameters = [...best.parameters];
    adamState = createAdamAscentState(meanParameters.length);
    stagnantGenerations = 0;
  }

  const statuses = candidates.reduce((counts, candidate) => {
    counts[candidate.result.status] = (counts[candidate.result.status] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);

  console.log('RESIDUAL_EVOLUTION_GENERATION', JSON.stringify({
    ...summary(best, generation, sigma),
    improved,
    updateAccepted,
    completedFraction: Number(completedFraction.toFixed(3)),
    gradientNorm: Number(gradientNorm.toFixed(6)),
    populationStatuses: statuses,
    populationBest: compactResult(populationBest.result),
    center: compactResult(center.result),
  }));
}

console.log('RESIDUAL_EVOLUTION_DONE', JSON.stringify({
  output: options.output,
  ...summary(best, options.generations, sigma),
}, null, 2));

function evaluate(parameters: readonly number[]): Candidate {
  const residual = residualDataWithParameters(residualTemplate, parameters);
  const result = evaluatePitwallLearningPolicy(
    ({ observation, projection }) => applyPitwallResidual(
      basePolicy.act(observation),
      projection.progress,
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
    basePolicy: options.input,
    generation,
    sigma: currentSigma,
    result: compactResult(candidate.result),
    algorithm: 'bounded-residual-rank-es-adam',
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

function cloneAdamState(state: AdamAscentState): AdamAscentState {
  return {
    firstMoment: [...state.firstMoment],
    secondMoment: [...state.secondMoment],
    step: state.step,
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
  const output = resolve(values.get('--output') ?? 'artifacts/pitwall-learning/policy-residual.json');
  const generations = positiveInteger(values.get('--generations'), 80);
  const requestedPopulation = Math.max(8, positiveInteger(values.get('--population'), 24));
  const population = requestedPopulation % 2 === 0 ? requestedPopulation : requestedPopulation + 1;
  const sigma = positiveNumber(values.get('--sigma'), 0.12);
  const learningRate = positiveNumber(values.get('--learning-rate'), 0.03);
  const sigmaDecay = clamp(positiveNumber(values.get('--sigma-decay'), 0.995), 0.90, 1);
  const seed = positiveInteger(values.get('--seed'), 56062);
  return { input, output, generations, population, sigma, learningRate, sigmaDecay, seed };
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
