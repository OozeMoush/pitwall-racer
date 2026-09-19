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
  PITWALL_RESIDUAL_CHANNELS,
  residualDataWithParameters,
  validatePitwallResidualPolicyData,
  type PitwallResidualPolicyData,
} from '../../src/simulation/PitwallResidualPolicy';
import {
  applyPitwallFineResidual,
  fineResidualDataWithParameters,
  PITWALL_FINE_RESIDUAL_CHANNELS,
  PITWALL_FINE_RESIDUAL_KNOTS,
  validatePitwallFineResidualPolicyData,
  type PitwallFineResidualPolicyData,
} from '../../src/simulation/PitwallFineResidualPolicy';
import {
  lineResidualDataWithParameters,
  PITWALL_LINE_RESIDUAL_KNOTS,
  samplePitwallLineResidual,
  validatePitwallLineResidualPolicyData,
  type PitwallLineResidualPolicyData,
} from '../../src/simulation/PitwallLineResidualPolicy';
import { installReferenceLineCalibration } from '../../src/simulation/ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from '../../src/simulation/ReferenceTrajectoryData';
import { TRACK_BARRIER_OFFSET } from '../../src/simulation/TrackLimitsModel';

type ControlLayer = 'coarse' | 'fine';

interface SearchOptions {
  coarse: string;
  fine: string;
  line: string;
  outputPrefix: string;
  generations: number;
  population: number;
  lineSigma: number;
  coarseSigma: number;
  fineSigma: number;
  seed: number;
}

interface JointState {
  coarse: number[];
  fine: number[];
  line: number[];
  result: PitwallLearningEpisodeResult;
}

interface StructuredPair {
  lineKnot: number;
  layer: ControlLayer;
  controlIndex: number;
  controlKnot: number;
  channel: number;
}

interface PairCandidate extends JointState {
  signs: [number, number];
  magnitudes: [number, number];
}

const options = parseOptions(process.argv.slice(2));
await RAPIER.init();

const coarseTemplate = await loadJson<PitwallResidualPolicyData>(
  options.coarse,
  validatePitwallResidualPolicyData,
);
const fineTemplate = await loadJson<PitwallFineResidualPolicyData>(
  options.fine,
  validatePitwallFineResidualPolicyData,
);
const lineTemplate = await loadJson<PitwallLineResidualPolicyData>(
  options.line,
  validatePitwallLineResidualPolicyData,
);

const absoluteGenome = createPitwallAbsoluteSeed();
installReferenceLineCalibration();
const baseLanes = materializePitwallAbsoluteLine(
  OPTIMIZED_REFERENCE_LANES['pitwall-gp'],
  absoluteGenome,
);

let incumbent = evaluate(
  coarseTemplate.parameters,
  fineTemplate.parameters,
  lineTemplate.parameters,
);
if (incumbent.result.status !== 'COMPLETED') {
  throw new Error(
    `Joint-search baseline must complete a valid lap; got ${incumbent.result.status} ${incumbent.result.invalidReason ?? ''}`,
  );
}

const random = mulberry32(options.seed);
let pairOrder = shuffled(buildStructuredPairs(), random);
let pairCursor = 0;
let pairCycle = 1;
let trustScale = 1;

await mkdir(dirname(options.outputPrefix), { recursive: true });
await saveState(incumbent, 0, trustScale);

console.log('JOINT_LINE_CONTROL_START', JSON.stringify({
  ...summary(incumbent, 0, trustScale),
  algorithm: 'sequential-structured-line-control-pattern-search',
  pairCount: pairOrder.length,
  pairsPerGeneration: options.population / 4,
  lineSigma: options.lineSigma,
  coarseSigma: options.coarseSigma,
  fineSigma: options.fineSigma,
  pairCycle,
}));

for (let generation = 1; generation <= options.generations; generation++) {
  const pairsThisGeneration = options.population / 4;
  let acceptedPairs = 0;
  let completedCandidates = 0;
  let totalCandidates = 0;
  const accepted: Array<Record<string, unknown>> = [];

  for (let pairNumber = 0; pairNumber < pairsThisGeneration; pairNumber++) {
    if (pairCursor >= pairOrder.length) {
      pairOrder = shuffled(buildStructuredPairs(), random);
      pairCursor = 0;
      pairCycle += 1;
    }

    const pair = pairOrder[pairCursor++];
    const lineMagnitude = clamp(Math.abs(normal(random)), 0.5, 1.5);
    const controlMagnitude = clamp(Math.abs(normal(random)), 0.5, 1.5);
    const candidates: PairCandidate[] = [];

    for (const signs of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const coarse = [...incumbent.coarse];
      const fine = [...incumbent.fine];
      const line = [...incumbent.line];

      line[pair.lineKnot] += signs[0]
        * options.lineSigma
        * trustScale
        * lineMagnitude;

      const controlSigma = pair.layer === 'coarse'
        ? options.coarseSigma
        : options.fineSigma;
      const controlDelta = signs[1]
        * controlSigma
        * trustScale
        * controlMagnitude;

      if (pair.layer === 'coarse') coarse[pair.controlIndex] += controlDelta;
      else fine[pair.controlIndex] += controlDelta;

      const candidate = evaluate(coarse, fine, line);
      candidates.push({
        ...candidate,
        signs: [signs[0], signs[1]],
        magnitudes: [lineMagnitude, controlMagnitude],
      });
      totalCandidates += 1;
      if (candidate.result.status === 'COMPLETED') completedCandidates += 1;
    }

    candidates.sort((a, b) => comparePitwallLearningResults(a.result, b.result));
    const best = candidates[0];

    if (
      best.result.status === 'COMPLETED'
      && comparePitwallLearningResults(best.result, incumbent.result) < 0
    ) {
      incumbent = {
        coarse: [...best.coarse],
        fine: [...best.fine],
        line: [...best.line],
        result: best.result,
      };
      acceptedPairs += 1;
      accepted.push({
        pair: pairLabel(pair),
        signs: best.signs,
        magnitudes: best.magnitudes.map((value) => Number(value.toFixed(3))),
        lapSeconds: best.result.lapSeconds === undefined
          ? null
          : Number(best.result.lapSeconds.toFixed(3)),
        preciseLapSeconds: best.result.preciseLapSeconds === undefined
          ? null
          : Number(best.result.preciseLapSeconds.toFixed(6)),
      });
      await saveState(incumbent, generation, trustScale);
    }
  }

  const completedFraction = completedCandidates / Math.max(1, totalCandidates);
  if (completedFraction === 0) trustScale *= 0.65;
  else if (completedFraction < 0.4) trustScale *= 0.82;
  else if (acceptedPairs >= 2 && completedFraction >= 0.7) trustScale *= 1.02;
  else if (acceptedPairs === 0) trustScale *= 0.94;
  else trustScale *= 0.995;
  trustScale = clamp(trustScale, 0.15, 1.5);

  console.log('JOINT_LINE_CONTROL_GENERATION', JSON.stringify({
    ...summary(incumbent, generation, trustScale),
    acceptedPairs,
    completedFraction: Number(completedFraction.toFixed(3)),
    pairCycle,
    pairsVisitedInCycle: pairCursor,
    accepted,
  }));
}

console.log('JOINT_LINE_CONTROL_DONE', JSON.stringify({
  ...summary(incumbent, options.generations, trustScale),
  outputs: outputPaths(),
  pairCycle,
  pairsVisitedInCycle: pairCursor,
}, null, 2));

function buildStructuredPairs(): StructuredPair[] {
  const pairs: StructuredPair[] = [];

  for (let lineKnot = 0; lineKnot < PITWALL_LINE_RESIDUAL_KNOTS; lineKnot++) {
    // Coarse residual has the same 32-knot progress grid as the line layer.
    for (let channel = 0; channel < PITWALL_RESIDUAL_CHANNELS; channel++) {
      pairs.push({
        lineKnot,
        layer: 'coarse',
        controlKnot: lineKnot,
        controlIndex: lineKnot * PITWALL_RESIDUAL_CHANNELS + channel,
        channel,
      });
    }

    // Fine residual has two 64-knot samples inside each line interval.
    for (const fineKnot of [
      (lineKnot * 2) % PITWALL_FINE_RESIDUAL_KNOTS,
      (lineKnot * 2 + 1) % PITWALL_FINE_RESIDUAL_KNOTS,
    ]) {
      for (let channel = 0; channel < PITWALL_FINE_RESIDUAL_CHANNELS; channel++) {
        pairs.push({
          lineKnot,
          layer: 'fine',
          controlKnot: fineKnot,
          controlIndex: fineKnot * PITWALL_FINE_RESIDUAL_CHANNELS + channel,
          channel,
        });
      }
    }
  }

  return pairs;
}

function evaluate(
  coarseParameters: readonly number[],
  fineParameters: readonly number[],
  lineParameters: readonly number[],
): JointState {
  const coarse = residualDataWithParameters(coarseTemplate, coarseParameters);
  const fine = fineResidualDataWithParameters(fineTemplate, fineParameters);
  const line = lineResidualDataWithParameters(lineTemplate, lineParameters);

  const teacher = createPitwallMachineTeacherPolicyForLine(
    baseLanes,
    absoluteGenome,
    {
      laneTargetLimit: TRACK_BARRIER_OFFSET - 0.25,
      laneResidual: (progress) => samplePitwallLineResidual(line, progress),
    },
  );

  const result = evaluatePitwallLearningPolicy(
    (context) => {
      const coarseAction = applyPitwallResidual(
        teacher(context),
        context.projection.progress,
        coarse,
      );
      return applyPitwallFineResidual(
        coarseAction,
        context.projection.progress,
        fine,
      );
    },
    { captureFlyingLap: false },
  );

  return {
    coarse: [...coarseParameters],
    fine: [...fineParameters],
    line: [...lineParameters],
    result,
  };
}

async function saveState(
  state: JointState,
  generation: number,
  currentTrustScale: number,
): Promise<void> {
  const paths = outputPaths();
  await writeFile(
    paths.coarse,
    `${JSON.stringify(residualDataWithParameters(coarseTemplate, state.coarse), null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    paths.fine,
    `${JSON.stringify(fineResidualDataWithParameters(fineTemplate, state.fine), null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    paths.line,
    `${JSON.stringify(lineResidualDataWithParameters(lineTemplate, state.line), null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    paths.meta,
    `${JSON.stringify({
      generation,
      trustScale: currentTrustScale,
      result: compactResult(state.result),
      algorithm: 'sequential-structured-line-control-pattern-search',
      inputPolicies: {
        coarse: options.coarse,
        fine: options.fine,
        line: options.line,
      },
      humanTelemetryUsed: false,
    }, null, 2)}\n`,
    'utf8',
  );
}

function outputPaths(): {
  coarse: string;
  fine: string;
  line: string;
  meta: string;
} {
  return {
    coarse: `${options.outputPrefix}-coarse.json`,
    fine: `${options.outputPrefix}-fine.json`,
    line: `${options.outputPrefix}-line.json`,
    meta: `${options.outputPrefix}.meta.json`,
  };
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
    lapSeconds: result.lapSeconds === undefined
      ? null
      : Number(result.lapSeconds.toFixed(3)),
    preciseLapSeconds: result.preciseLapSeconds === undefined
      ? null
      : Number(result.preciseLapSeconds.toFixed(6)),
    forwardProgressMetres: Number(result.forwardProgressMetres.toFixed(1)),
    maxLaneDistance: Number(result.maxLaneDistance.toFixed(3)),
    peakSlideSeverity: Number(result.peakSlideSeverity.toFixed(3)),
  };
}

function summary(
  state: JointState,
  generation: number,
  currentTrustScale: number,
): Record<string, unknown> {
  return {
    generation,
    trustScale: Number(currentTrustScale.toFixed(6)),
    ...compactResult(state.result),
  };
}

function pairLabel(pair: StructuredPair): string {
  return `line[k${pair.lineKnot}]+${pair.layer}[k${pair.controlKnot}:${channelName(pair.channel)}]`;
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
  const lineRaw = values.get('--line');
  if (!coarseRaw) throw new Error('--coarse is required');
  if (!fineRaw) throw new Error('--fine is required');
  if (!lineRaw) throw new Error('--line is required');

  const requestedPopulation = Math.max(
    8,
    positiveInteger(values.get('--population'), 24),
  );
  const population = Math.ceil(requestedPopulation / 4) * 4;

  return {
    coarse: resolve(coarseRaw),
    fine: resolve(fineRaw),
    line: resolve(lineRaw),
    outputPrefix: resolve(
      values.get('--output-prefix')
        ?? 'artifacts/pitwall-learning/policy-joint',
    ),
    generations: positiveInteger(values.get('--generations'), 48),
    population,
    lineSigma: positiveNumber(values.get('--line-sigma'), 0.05),
    coarseSigma: positiveNumber(values.get('--coarse-sigma'), 0.04),
    fineSigma: positiveNumber(values.get('--fine-sigma'), 0.08),
    seed: positiveInteger(values.get('--seed'), 56066),
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
