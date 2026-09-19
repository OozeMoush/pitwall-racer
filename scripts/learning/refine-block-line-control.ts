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

type BlockMode = 'coherent' | 'phase';

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

interface SearchBlock {
  center: number;
  channel: number;
  mode: BlockMode;
}

interface BlockCandidate extends JointState {
  direction: [number, number];
  lineMagnitude: number;
  controlMagnitude: number;
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
    `Block-search baseline must complete a valid lap; got ${incumbent.result.status} ${incumbent.result.invalidReason ?? ''}`,
  );
}

let trustScale = 1;
const random = mulberry32(options.seed);
let blockOrder = shuffled(buildBlocks(), random);
let blockCursor = 0;
let blockCycle = 1;

await mkdir(dirname(options.outputPrefix), { recursive: true });
await saveState(incumbent, 0, trustScale);

console.log('BLOCK_LINE_CONTROL_START', JSON.stringify({
  ...summary(incumbent, 0, trustScale),
  algorithm: 'sequential-corner-block-pattern-search',
  blockCount: blockOrder.length,
  blocksPerGeneration: options.population / 8,
  lineSigma: options.lineSigma,
  coarseSigma: options.coarseSigma,
  fineSigma: options.fineSigma,
  blockCycle,
}));

for (let generation = 1; generation <= options.generations; generation++) {
  const blocksThisGeneration = options.population / 8;
  let acceptedBlocks = 0;
  let completedCandidates = 0;
  let totalCandidates = 0;
  const accepted: Array<Record<string, unknown>> = [];

  for (let blockNumber = 0; blockNumber < blocksThisGeneration; blockNumber++) {
    if (blockCursor >= blockOrder.length) {
      blockOrder = shuffled(buildBlocks(), random);
      blockCursor = 0;
      blockCycle += 1;
    }

    const block = blockOrder[blockCursor++];
    const lineMagnitude = clamp(Math.abs(normal(random)), 0.6, 1.4);
    const controlMagnitude = clamp(Math.abs(normal(random)), 0.6, 1.4);
    const candidates: BlockCandidate[] = [];

    // Include block-only moves as well as coupled moves. The local searches have
    // already exhausted individual knots, but a smooth corner-scale move can
    // cross a valley that no single coordinate can improve.
    const directions = [
      [1, 0], [-1, 0],
      [0, 1], [0, -1],
      [1, 1], [1, -1],
      [-1, 1], [-1, -1],
    ] as const;

    for (const direction of directions) {
      const coarse = [...incumbent.coarse];
      const fine = [...incumbent.fine];
      const line = [...incumbent.line];

      if (direction[0] !== 0) {
        mutateLineBlock(
          line,
          block.center,
          direction[0] * options.lineSigma * trustScale * lineMagnitude,
        );
      }

      if (direction[1] !== 0) {
        mutateControlBlock(
          coarse,
          fine,
          block,
          direction[1] * trustScale * controlMagnitude,
        );
      }

      const candidate = evaluate(coarse, fine, line);
      candidates.push({
        ...candidate,
        direction: [direction[0], direction[1]],
        lineMagnitude,
        controlMagnitude,
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
      acceptedBlocks += 1;
      accepted.push({
        block: blockLabel(block),
        direction: best.direction,
        lineMagnitude: Number(best.lineMagnitude.toFixed(3)),
        controlMagnitude: Number(best.controlMagnitude.toFixed(3)),
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
  if (completedFraction === 0) trustScale *= 0.60;
  else if (completedFraction < 0.4) trustScale *= 0.80;
  else if (acceptedBlocks >= 2 && completedFraction >= 0.7) trustScale *= 1.03;
  else if (acceptedBlocks === 0) trustScale *= 0.94;
  else trustScale *= 0.995;
  trustScale = clamp(trustScale, 0.12, 1.5);

  console.log('BLOCK_LINE_CONTROL_GENERATION', JSON.stringify({
    ...summary(incumbent, generation, trustScale),
    acceptedBlocks,
    completedFraction: Number(completedFraction.toFixed(3)),
    blockCycle,
    blocksVisitedInCycle: blockCursor,
    accepted,
  }));
}

console.log('BLOCK_LINE_CONTROL_DONE', JSON.stringify({
  ...summary(incumbent, options.generations, trustScale),
  outputs: outputPaths(),
  blockCycle,
  blocksVisitedInCycle: blockCursor,
}, null, 2));

function buildBlocks(): SearchBlock[] {
  const blocks: SearchBlock[] = [];
  for (let center = 0; center < PITWALL_LINE_RESIDUAL_KNOTS; center++) {
    for (let channel = 0; channel < PITWALL_RESIDUAL_CHANNELS; channel++) {
      blocks.push({ center, channel, mode: 'coherent' });
      blocks.push({ center, channel, mode: 'phase' });
    }
  }
  return blocks;
}

function mutateLineBlock(
  parameters: number[],
  center: number,
  amplitude: number,
): void {
  const radius = 2;
  for (let index = 0; index < parameters.length; index++) {
    const offset = circularKnotOffset(index, center, parameters.length);
    const weight = bumpWeight(offset, radius);
    if (weight === 0) continue;
    parameters[index] += amplitude * weight;
  }
}

function mutateControlBlock(
  coarse: number[],
  fine: number[],
  block: SearchBlock,
  signedMagnitude: number,
): void {
  const coarseRadius = 2;
  const fineCenter = block.center * 2;
  const fineRadius = 4;

  for (let knot = 0; knot < PITWALL_LINE_RESIDUAL_KNOTS; knot++) {
    const offset = circularKnotOffset(
      knot,
      block.center,
      PITWALL_LINE_RESIDUAL_KNOTS,
    );
    const basis = block.mode === 'coherent'
      ? bumpWeight(offset, coarseRadius)
      : shiftWeight(offset, coarseRadius);
    if (basis === 0) continue;
    const index = knot * PITWALL_RESIDUAL_CHANNELS + block.channel;
    coarse[index] += signedMagnitude * options.coarseSigma * basis;
  }

  for (let knot = 0; knot < PITWALL_FINE_RESIDUAL_KNOTS; knot++) {
    const offset = circularKnotOffset(
      knot,
      fineCenter,
      PITWALL_FINE_RESIDUAL_KNOTS,
    );
    const basis = block.mode === 'coherent'
      ? bumpWeight(offset, fineRadius)
      : shiftWeight(offset, fineRadius);
    if (basis === 0) continue;
    const index = knot * PITWALL_FINE_RESIDUAL_CHANNELS + block.channel;
    fine[index] += signedMagnitude * options.fineSigma * basis;
  }
}

function bumpWeight(offset: number, radius: number): number {
  const distance = Math.abs(offset);
  if (distance > radius) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * distance / (radius + 1)));
}

function shiftWeight(offset: number, radius: number): number {
  if (offset === 0) return 0;
  const envelope = bumpWeight(offset, radius);
  return -Math.sign(offset) * envelope;
}

function circularKnotOffset(index: number, center: number, length: number): number {
  let offset = index - center;
  while (offset > length / 2) offset -= length;
  while (offset < -length / 2) offset += length;
  return offset;
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
      algorithm: 'sequential-corner-block-pattern-search',
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

function blockLabel(block: SearchBlock): string {
  return `${block.mode}:k${block.center}:${channelName(block.channel)}`;
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
  const population = Math.ceil(requestedPopulation / 8) * 8;

  return {
    coarse: resolve(coarseRaw),
    fine: resolve(fineRaw),
    line: resolve(lineRaw),
    outputPrefix: resolve(
      values.get('--output-prefix')
        ?? 'artifacts/pitwall-learning/policy-block',
    ),
    generations: positiveInteger(values.get('--generations'), 64),
    population,
    lineSigma: positiveNumber(values.get('--line-sigma'), 0.05),
    coarseSigma: positiveNumber(values.get('--coarse-sigma'), 0.035),
    fineSigma: positiveNumber(values.get('--fine-sigma'), 0.07),
    seed: positiveInteger(values.get('--seed'), 56067),
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
