import RAPIER from '@dimforge/rapier2d-compat';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  comparePitwallLearningResults,
  evaluatePitwallLearningPolicy,
  type PitwallLearningEpisodeResult,
} from '../../src/simulation/PitwallLearningEnvironment';
import { createPitwallMachineTeacherPolicy } from '../../src/simulation/PitwallMachineTeacherPolicy';
import {
  applyPitwallResidual,
  PITWALL_RESIDUAL_CHANNELS,
  PITWALL_RESIDUAL_KNOTS,
  residualDataWithParameters,
  validatePitwallResidualPolicyData,
  type PitwallResidualPolicyData,
} from '../../src/simulation/PitwallResidualPolicy';

interface Options {
  input: string;
  output: string;
  generations: number;
  population: number;
  sigma: number;
  sigmaDecay: number;
  seed: number;
}

interface Coordinate {
  index: number;
  knot: number;
  channel: number;
}

interface LocalPair {
  a: Coordinate;
  b: Coordinate;
  kind: 'same-knot-cross-channel' | 'adjacent-knot-same-channel';
}

interface Candidate {
  parameters: number[];
  result: PitwallLearningEpisodeResult;
}

interface PairCandidate extends Candidate {
  signs: [number, number];
  magnitudes: [number, number];
}

const options = parseOptions(process.argv.slice(2));
await RAPIER.init();

const basePolicy = createPitwallMachineTeacherPolicy();
const template = await loadResidual(options.input);
let incumbent = evaluate(template.parameters);
if (incumbent.result.status !== 'COMPLETED') {
  throw new Error(
    `Input residual must complete a valid lap; got ${incumbent.result.status} ${incumbent.result.invalidReason ?? ''}`,
  );
}

let sigma = options.sigma;
const random = mulberry32(options.seed);
let pairOrder = shuffled(buildPrimaryLocalPairs(), random);
let pairCursor = 0;
let pairCycle = 1;

await mkdir(dirname(options.output), { recursive: true });
await saveCandidate(options.output, incumbent, 0, sigma);

console.log('PAIR_RESIDUAL_REFINEMENT_START', JSON.stringify({
  ...summary(incumbent, 0, sigma),
  algorithm: 'sequential-local-pair-pattern-search',
  input: options.input,
  pairCount: pairOrder.length,
  pairsPerGeneration: options.population / 4,
  pairCycle,
  residualStats: residualStats(template),
}));

for (let generation = 1; generation <= options.generations; generation++) {
  const pairsThisGeneration = options.population / 4;
  let acceptedPairs = 0;
  let completedCandidates = 0;
  let totalCandidates = 0;
  const accepted: Array<Record<string, unknown>> = [];
  let lastPair: LocalPair | undefined;

  for (let pairIndex = 0; pairIndex < pairsThisGeneration; pairIndex++) {
    if (pairCursor >= pairOrder.length) {
      pairOrder = shuffled(buildPrimaryLocalPairs(), random);
      pairCursor = 0;
      pairCycle += 1;
    }

    const pair = pairOrder[pairCursor++];
    lastPair = pair;
    const magnitudeA = clamp(Math.abs(normal(random)), 0.35, 1.75);
    const magnitudeB = clamp(Math.abs(normal(random)), 0.35, 1.75);
    const candidates: PairCandidate[] = [];

    // Evaluate the complete local 2-D sign pattern. Mixed signs are important:
    // a later turn-in can be useful only when an adjacent control is relaxed.
    for (const signs of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const parameters = [...incumbent.parameters];
      parameters[pair.a.index] += signs[0] * sigma * magnitudeA;
      parameters[pair.b.index] += signs[1] * sigma * magnitudeB;
      const candidate = evaluate(parameters);
      candidates.push({
        ...candidate,
        signs: [signs[0], signs[1]],
        magnitudes: [magnitudeA, magnitudeB],
      });
      totalCandidates += 1;
      if (candidate.result.status === 'COMPLETED') completedCandidates += 1;
    }

    candidates.sort((a, b) => comparePitwallLearningResults(a.result, b.result));
    const best = candidates[0];

    // Sequential acceptance matters here: every later pair is evaluated around
    // the best physically verified checkpoint found so far, rather than throwing
    // away independent improvements that happened in the same generation.
    if (best.result.status === 'COMPLETED'
      && comparePitwallLearningResults(best.result, incumbent.result) < 0) {
      incumbent = {
        parameters: [...best.parameters],
        result: best.result,
      };
      acceptedPairs += 1;
      accepted.push({
        kind: pair.kind,
        a: coordinateLabel(pair.a),
        b: coordinateLabel(pair.b),
        signs: best.signs,
        magnitudes: best.magnitudes.map((value) => Number(value.toFixed(3))),
        lapSeconds: compactResult(best.result).lapSeconds,
        preciseLapSeconds: compactResult(best.result).preciseLapSeconds,
      });
      await saveCandidate(options.output, incumbent, generation, sigma);
    }
  }

  const completedFraction = completedCandidates / Math.max(1, totalCandidates);
  if (completedFraction === 0) {
    sigma *= 0.60;
  } else if (completedFraction < 0.45) {
    sigma *= 0.82;
  } else if (acceptedPairs >= 2 && completedFraction >= 0.75) {
    sigma *= 1.025;
  } else if (acceptedPairs === 0) {
    sigma *= 0.92;
  } else {
    sigma *= options.sigmaDecay;
  }
  sigma = clamp(sigma, 0.003, 0.15);

  console.log('PAIR_RESIDUAL_REFINEMENT_GENERATION', JSON.stringify({
    ...summary(incumbent, generation, sigma),
    acceptedPairs,
    completedFraction: Number(completedFraction.toFixed(3)),
    pairCycle,
    pairsVisitedInCycle: pairCursor,
    lastPair: lastPair ? pairLabel(lastPair) : null,
    accepted,
  }));
}

console.log('PAIR_RESIDUAL_REFINEMENT_DONE', JSON.stringify({
  output: options.output,
  ...summary(incumbent, options.generations, sigma),
  pairCycle,
  pairsVisitedInCycle: pairCursor,
  residualStats: residualStats(
    residualDataWithParameters(template, incumbent.parameters),
  ),
}, null, 2));

function buildPrimaryLocalPairs(): LocalPair[] {
  const pairs: LocalPair[] = [];

  // Same progress knot, different actuators: steering/brake/throttle coupling.
  for (let knot = 0; knot < PITWALL_RESIDUAL_KNOTS; knot++) {
    for (const [aChannel, bChannel] of [[0, 1], [0, 2], [1, 2]] as const) {
      pairs.push({
        a: coordinate(knot, aChannel),
        b: coordinate(knot, bChannel),
        kind: 'same-knot-cross-channel',
      });
    }
  }

  // Neighboring progress knots on the same actuator: captures turn-in/release
  // timing shifts that cannot be represented by changing one knot in isolation.
  for (let knot = 0; knot < PITWALL_RESIDUAL_KNOTS; knot++) {
    const next = (knot + 1) % PITWALL_RESIDUAL_KNOTS;
    for (let channel = 0; channel < PITWALL_RESIDUAL_CHANNELS; channel++) {
      pairs.push({
        a: coordinate(knot, channel),
        b: coordinate(next, channel),
        kind: 'adjacent-knot-same-channel',
      });
    }
  }

  return pairs;
}

function coordinate(knot: number, channel: number): Coordinate {
  return {
    index: knot * PITWALL_RESIDUAL_CHANNELS + channel,
    knot,
    channel,
  };
}

function evaluate(parameters: readonly number[]): Candidate {
  const residual = residualDataWithParameters(template, parameters);
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

async function loadResidual(path: string): Promise<PitwallResidualPolicyData> {
  const data = JSON.parse(await readFile(path, 'utf8')) as PitwallResidualPolicyData;
  validatePitwallResidualPolicyData(data);
  return data;
}

async function saveCandidate(
  output: string,
  candidate: Candidate,
  generation: number,
  currentSigma: number,
): Promise<void> {
  const residual = residualDataWithParameters(template, candidate.parameters);
  await writeFile(output, `${JSON.stringify(residual, null, 2)}\n`, 'utf8');
  const meta = output.endsWith('.json')
    ? output.slice(0, -5) + '.meta.json'
    : `${output}.meta.json`;
  await writeFile(meta, `${JSON.stringify({
    basePolicy: 'machine-only-pitwall-absolute-seed',
    input: options.input,
    generation,
    sigma: currentSigma,
    result: compactResult(candidate.result),
    algorithm: 'sequential-local-pair-pattern-search',
    humanTelemetryUsed: false,
  }, null, 2)}\n`, 'utf8');
}

function compactResult(result: PitwallLearningEpisodeResult): Record<string, number | string | null> {
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

function residualStats(data: PitwallResidualPolicyData): Record<string, unknown> {
  const scales = [data.steerScale, data.throttleScale, data.brakeScale];
  const channels = ['steer', 'throttle', 'brake'];
  return Object.fromEntries(channels.map((name, channel) => {
    const values: number[] = [];
    for (let index = channel; index < data.parameters.length; index += PITWALL_RESIDUAL_CHANNELS) {
      values.push(data.parameters[index]);
    }
    const maxAbs = Math.max(0, ...values.map(Math.abs));
    const meanAbs = values.reduce((sum, value) => sum + Math.abs(value), 0)
      / Math.max(1, values.length);
    return [name, {
      maxAbsParameter: Number(maxAbs.toFixed(4)),
      meanAbsParameter: Number(meanAbs.toFixed(4)),
      maxPhysicalCorrection: Number((scales[channel] * Math.tanh(maxAbs)).toFixed(4)),
    }];
  }));
}

function coordinateLabel(value: Coordinate): string {
  return `k${value.knot}:${channelName(value.channel)}`;
}

function pairLabel(pair: LocalPair): string {
  return `${pair.kind}(${coordinateLabel(pair.a)},${coordinateLabel(pair.b)})`;
}

function channelName(channel: number): string {
  return ['steer', 'throttle', 'brake'][channel] ?? `channel-${channel}`;
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function parseOptions(args: string[]): Options {
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

  const inputRaw = values.get('--input');
  if (!inputRaw) throw new Error('--input is required for pair refinement');
  const input = resolve(inputRaw);
  const output = resolve(
    values.get('--output') ?? 'artifacts/pitwall-learning/policy-residual-pairs.json',
  );
  const generations = positiveInteger(values.get('--generations'), 32);
  const requestedPopulation = Math.max(8, positiveInteger(values.get('--population'), 24));
  const population = Math.ceil(requestedPopulation / 4) * 4;
  const sigma = positiveNumber(values.get('--sigma'), 0.04);
  const sigmaDecay = clamp(positiveNumber(values.get('--sigma-decay'), 0.995), 0.90, 1);
  const seed = positiveInteger(values.get('--seed'), 56063);
  return { input, output, generations, population, sigma, sigmaDecay, seed };
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
