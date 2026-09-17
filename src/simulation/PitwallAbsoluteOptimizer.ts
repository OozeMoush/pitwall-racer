import { evaluateMachineFlyingLap, type MachineLapResult } from './MachineLapEvaluator';
import { PitwallAbsolutePilot } from './PitwallAbsolutePilot';
import { materializePitwallAbsoluteProfile } from './PitwallAbsoluteProfileTuning';
import {
  createPitwallJointSeed,
  materializePitwallJointLine,
  type PitwallJointGenome,
} from './PitwallJointOptimizer';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';

// These are Pitwall-specific progress controls, not a universal circuit model.
// The final-complex centres match legal executable headroom discovered by the
// local speed-window probe instead of rounding them onto a generic grid.
const SPEED_CENTERS = [0.515, 0.545, 0.575, 0.605, 0.875, 0.905, 0.925, 0.945] as const;
const SPEED_HALF_WIDTH = 0.018;
const LINE_INDICES = [2, 6, 7, 8] as const;

export interface PitwallAbsoluteGenome {
  /** Broad machine-only speed lift through the central technical complex. */
  centralSpeedLift: number;
  /** Local additive m/s changes around SPEED_CENTERS. */
  speedDeltas: number[];
  /** Full Pitwall course-specific lane genome inherited from the machine line seed. */
  lineDeltas: number[];
  predictionScale: number;
  lookAheadScale: number;
  speedFeedback: number;
}

export interface PitwallAbsoluteEvaluation {
  genome: PitwallAbsoluteGenome;
  result: MachineLapResult;
  legal: boolean;
  score: number;
}

export interface PitwallAbsoluteOptimizationResult {
  seed: PitwallAbsoluteEvaluation;
  best: PitwallAbsoluteEvaluation;
  guide: PitwallAbsoluteEvaluation;
  evaluations: number;
  accepted: Array<{
    seconds: number;
    maxLaneDistance: number;
    illegalSamples: number;
  }>;
}

export interface PitwallAbsoluteOptimizerOptions {
  maxEvaluations?: number;
  randomSeed?: number;
}

interface Dimension {
  step: number;
  min: number;
  max: number;
  get(genome: PitwallAbsoluteGenome): number;
  set(genome: PitwallAbsoluteGenome, value: number): void;
}

/**
 * Pitwall-specific executable optimizer for the ReferenceDriver-independent
 * longitudinal controller. Human traces and target lap times are never inputs.
 * Every candidate is judged by a complete 120 Hz full-state flying lap using
 * the shared player-car grip, power and chassis model.
 */
export function optimizePitwallAbsolute(
  calibratedReference: readonly number[],
  options: PitwallAbsoluteOptimizerOptions = {},
): PitwallAbsoluteOptimizationResult {
  const maxEvaluations = Math.max(1, options.maxEvaluations ?? 40);
  const random = mulberry32(options.randomSeed ?? 0xa85e1d3);
  const seed = evaluatePitwallAbsolute(calibratedReference, createPitwallAbsoluteSeed());
  let best = seed;
  let guide = seed;
  let evaluations = 1;
  const accepted: PitwallAbsoluteOptimizationResult['accepted'] = [];

  const consider = (candidate: PitwallAbsoluteEvaluation) => {
    if (candidate.score < guide.score) guide = candidate;
    if (!candidate.legal || candidate.result.lapSeconds === undefined) return;
    if (best.result.lapSeconds === undefined
      || candidate.result.lapSeconds + 0.001 < best.result.lapSeconds) {
      best = candidate;
      accepted.push({
        seconds: Number(candidate.result.lapSeconds.toFixed(3)),
        maxLaneDistance: Number(candidate.result.maxLaneDistance.toFixed(3)),
        illegalSamples: candidate.result.illegalSamples,
      });
    }
  };

  // First challenge each local speed dimension independently. +1.5 m/s is
  // included because executable probing found legal islands at that value that
  // +0.5/+1.0 alone would miss.
  for (let index = 0; index < SPEED_CENTERS.length && evaluations < maxEvaluations; index++) {
    for (const delta of [0.5, 1.0, 1.5] as const) {
      if (evaluations >= maxEvaluations) break;
      const genome = cloneGenome(best.genome);
      genome.speedDeltas[index] += delta;
      const candidate = evaluatePitwallAbsolute(calibratedReference, genome);
      evaluations += 1;
      consider(candidate);
    }
  }

  const dimensions = buildDimensions();
  let generation = 0;
  while (evaluations < maxEvaluations) {
    const temperature = Math.max(0.24, Math.pow(0.92, generation));
    const parent = generation % 3 === 2 ? guide : best;
    const genome = cloneGenome(parent.genome);
    const mutationCount = 2 + Math.floor(random() * 3);
    const used = new Set<number>();

    for (let mutation = 0; mutation < mutationCount; mutation++) {
      let dimensionIndex = Math.floor(random() * dimensions.length);
      for (let retry = 0; retry < 5 && used.has(dimensionIndex); retry++) {
        dimensionIndex = Math.floor(random() * dimensions.length);
      }
      used.add(dimensionIndex);
      const dimension = dimensions[dimensionIndex];
      const value = dimension.get(genome);
      dimension.set(genome, clamp(
        value + normal(random) * dimension.step * temperature,
        dimension.min,
        dimension.max,
      ));
    }

    const candidate = evaluatePitwallAbsolute(calibratedReference, genome);
    evaluations += 1;
    consider(candidate);
    generation += 1;
  }

  return { seed, best, guide, evaluations, accepted };
}

/**
 * Fastest completely legal ReferenceDriver-independent lightweight seed found
 * so far. Executable search improved the 25.517 s seed to 25.475 s by adding
 * +1.0 m/s around 54.5% progress and raising the 94.5% window to +2.5 m/s.
 * The values are machine-discovered and are not derived from player telemetry.
 */
export function createPitwallAbsoluteSeed(): PitwallAbsoluteGenome {
  const lineSeed = createPitwallJointSeed();
  const lineDeltas = [...lineSeed.lineDeltas];
  lineDeltas[6] -= 0.30;
  return {
    centralSpeedLift: 4.0,
    speedDeltas: [0, 1.0, 0, 0, 0, 1.5, 1.5, 2.5],
    lineDeltas,
    predictionScale: 0.10,
    lookAheadScale: 1,
    speedFeedback: 1.5,
  };
}

/** Build the exact pilot represented by an absolute genome for either evaluator. */
export function createPitwallAbsolutePilot(
  calibratedReference: readonly number[],
  genome: PitwallAbsoluteGenome,
): PitwallAbsolutePilot {
  const lineGenome = lineGenomeFromAbsolute(genome);
  const lanes = materializePitwallJointLine(calibratedReference, lineGenome);
  const profile = materializePitwallAbsoluteProfile({
    centralSpeedLift: genome.centralSpeedLift,
    speedWindows: SPEED_CENTERS.map((center, index) => ({
      center,
      halfWidth: SPEED_HALF_WIDTH,
      delta: genome.speedDeltas[index] ?? 0,
    })),
  });
  return new PitwallAbsolutePilot(lanes, {
    profile,
    predictionScale: genome.predictionScale,
    lookAheadScale: genome.lookAheadScale,
    speedFeedback: genome.speedFeedback,
  });
}

export function evaluatePitwallAbsolute(
  calibratedReference: readonly number[],
  genome: PitwallAbsoluteGenome,
): PitwallAbsoluteEvaluation {
  const pilot = createPitwallAbsolutePilot(calibratedReference, genome);
  const result = evaluateMachineFlyingLap({
    trackId: 'pitwall-gp',
    policy: (context) => pilot.control(context),
    maximumSeconds: 60,
    tireWear: 0,
    tyreSlideSeed: 0.37,
  });

  const legal = result.completed
    && result.lapSeconds !== undefined
    && result.illegalSamples === 0
    && result.maxLaneDistance <= REFERENCE_LANE_LIMIT
    && result.slideEvents === 0;
  const overflow = Math.max(0, result.maxLaneDistance - REFERENCE_LANE_LIMIT);
  const illegalRatio = result.illegalSamples / Math.max(1, result.samples);
  const score = result.completed && result.lapSeconds !== undefined
    ? result.lapSeconds + overflow * 0.04 + illegalRatio * 0.7 + result.maxSlideSeverity * 0.25
    : 100 + (result.lapSeconds ?? 60) + overflow;

  return {
    genome: cloneGenome(genome),
    result,
    legal,
    score,
  };
}

function lineGenomeFromAbsolute(genome: PitwallAbsoluteGenome): PitwallJointGenome {
  const seed = createPitwallJointSeed();
  return {
    ...seed,
    lineDeltas: [...genome.lineDeltas],
  };
}

function buildDimensions(): Dimension[] {
  const dimensions: Dimension[] = [
    scalarDimension('centralSpeedLift', 0.45, 2.5, 5.5),
    scalarDimension('predictionScale', 0.045, 0.02, 0.55),
    scalarDimension('lookAheadScale', 0.025, 0.94, 1.06),
    scalarDimension('speedFeedback', 0.10, 1.15, 1.85),
  ];
  for (let index = 0; index < SPEED_CENTERS.length; index++) {
    dimensions.push(arrayDimension('speedDeltas', index, 0.55, -0.5, 3.0));
  }
  for (const index of LINE_INDICES) {
    dimensions.push(arrayDimension('lineDeltas', index, 0.22, -1.6, 1.6));
  }
  return dimensions;
}

function scalarDimension(
  key: 'centralSpeedLift' | 'predictionScale' | 'lookAheadScale' | 'speedFeedback',
  step: number,
  min: number,
  max: number,
): Dimension {
  return {
    step,
    min,
    max,
    get: (genome) => genome[key],
    set: (genome, value) => { genome[key] = value; },
  };
}

function arrayDimension(
  key: 'speedDeltas' | 'lineDeltas',
  index: number,
  step: number,
  min: number,
  max: number,
): Dimension {
  return {
    step,
    min,
    max,
    get: (genome) => genome[key][index],
    set: (genome, value) => { genome[key][index] = value; },
  };
}

function cloneGenome(genome: PitwallAbsoluteGenome): PitwallAbsoluteGenome {
  return {
    centralSpeedLift: genome.centralSpeedLift,
    speedDeltas: [...genome.speedDeltas],
    lineDeltas: [...genome.lineDeltas],
    predictionScale: genome.predictionScale,
    lookAheadScale: genome.lookAheadScale,
    speedFeedback: genome.speedFeedback,
  };
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
