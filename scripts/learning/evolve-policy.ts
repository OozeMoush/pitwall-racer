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
} from '../../src/simulation/PitwallEvolutionStrategy';
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
  learningRate: number;
  sigmaDecay: number;
  seed: number;
}

interface Candidate {
  parameters: number[];
  result: PitwallLearningEpisodeResult;
}

interface PerturbedCandidate extends Candidate {
  /** Signed standard-normal perturbation before multiplication by sigma. */
  noise: number[];
}

const options = parseOptions(process.argv.slice(2));
await RAPIER.init();

const inputData = JSON.parse(await readFile(options.input, 'utf8')) as PitwallNeuralPolicyData;
const policyTemplate = new PitwallNeuralPolicy(inputData);
let meanParameters = policyTemplate.parameters();
let best = evaluate(meanParameters);
let sigma = options.sigma;
let adamState = createAdamAscentState(meanParameters.length);
let stagnantGenerations = 0;
const random = mulberry32(options.seed);

await mkdir(dirname(options.output), { recursive: true });
await saveCandidate(options.output, best, {
  generation: 0,
  algorithm: 'rank-es-adam',
  sigma,
  options,
});

console.log('LEARNING_EVOLUTION_START', JSON.stringify({
  ...summary(best, 0, sigma),
  parameterCount: meanParameters.length,
  algorithm: 'rank-es-adam',
}));

for (let generation = 1; generation <= options.generations; generation++) {
  const candidates: PerturbedCandidate[] = [];
  const pairCount = options.population / 2;

  // Antithetic perturbations reduce variance: each random direction is tested
  // both positively and negatively through the exact same Rapier environment.
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

  // Utilities depend only on lexicographic ordering. No numeric penalty says
  // how many seconds grass, runoff, or invalidity is "worth". Completed valid
  // laps dominate, then lap time; curriculum progress only orders lower tiers.
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

  meanParameters = adamAscent(
    meanParameters,
    gradient,
    adamState,
    options.learningRate,
  );
  const center = evaluate(meanParameters);

  const ranked = [...candidates].sort(
    (a, b) => comparePitwallLearningResults(a.result, b.result),
  );
  const populationBest = ranked[0];
  let improved = false;
  for (const challenger of [populationBest, center]) {
    if (comparePitwallLearningResults(challenger.result, best.result) < 0) {
      best = {
        parameters: [...challenger.parameters],
        result: challenger.result,
      };
      improved = true;
    }
  }

  if (improved) {
    stagnantGenerations = 0;
    await saveCandidate(options.output, best, {
      generation,
      algorithm: 'rank-es-adam',
      sigma,
      options,
    });
  } else {
    stagnantGenerations += 1;
  }

  sigma = Math.max(0.0015, sigma * options.sigmaDecay);

  // If the rank-gradient walks into a brittle basin, return the search mean to
  // the best physically verified policy without changing that best checkpoint.
  // This is a search-stability mechanism, not a driving reward.
  if (stagnantGenerations >= 15) {
    meanParameters = [...best.parameters];
    adamState = createAdamAscentState(meanParameters.length);
    sigma = Math.max(sigma, options.sigma * 0.55);
    stagnantGenerations = 0;
  }

  const statuses = candidates.reduce((counts, candidate) => {
    counts[candidate.result.status] = (counts[candidate.result.status] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  const gradientNorm = Math.sqrt(gradient.reduce((sum, value) => sum + value * value, 0));

  console.log('LEARNING_EVOLUTION_GENERATION', JSON.stringify({
    ...summary(best, generation, sigma),
    improved,
    gradientNorm: Number(gradientNorm.toFixed(6)),
    populationStatuses: statuses,
    populationBest: compactResult(populationBest.result),
    center: compactResult(center.result),
  }));
}

console.log('LEARNING_EVOLUTION_DONE', JSON.stringify({
  output: options.output,
  ...summary(best, options.generations, sigma),
}, null, 2));

function evaluate(parameters: readonly number[]): Candidate {
  const policy = policyTemplate.withParameters(parameters);
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
  const policy = policyTemplate.withParameters(candidate.parameters);
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
  const requestedPopulation = Math.max(4, positiveInteger(values.get('--population'), 24));
  const population = requestedPopulation % 2 === 0 ? requestedPopulation : requestedPopulation + 1;
  const sigma = positiveNumber(values.get('--sigma'), 0.018);
  const learningRate = positiveNumber(values.get('--learning-rate'), 0.006);
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
