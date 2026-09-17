import { evaluateMachineFlyingLap, type MachineLapResult } from './MachineLapEvaluator';
import {
  MachineLinePilot,
  type MachineBrakeWindow,
  type MachineSpeedWindow,
} from './MachineLinePilot';
import { buildMachineOptimalPitwallLine } from './MachineOptimalLine';
import { REFERENCE_LANE_LIMIT } from './ReferenceDriverModel';

interface LineControlPoint {
  center: number;
  halfWidth: number;
}

const LINE_CONTROLS: readonly LineControlPoint[] = [
  { center: 0.47, halfWidth: 0.028 },
  { center: 0.51, halfWidth: 0.028 },
  { center: 0.55, halfWidth: 0.028 },
  { center: 0.59, halfWidth: 0.028 },
  { center: 0.63, halfWidth: 0.028 },
  { center: 0.67, halfWidth: 0.028 },
  { center: 0.86, halfWidth: 0.028 },
  { center: 0.90, halfWidth: 0.028 },
  { center: 0.94, halfWidth: 0.028 },
  { center: 0.98, halfWidth: 0.025 },
  { center: 0.02, halfWidth: 0.025 },
] as const;

const SPEED_CENTERS = [0.48, 0.52, 0.56, 0.60, 0.64, 0.88, 0.92, 0.96, 0.00, 0.04] as const;
const BRAKE_CENTERS = [0.50, 0.56, 0.88, 0.94, 0.01] as const;

export interface PitwallJointGenome {
  lineDeltas: number[];
  speedScales: number[];
  brakeScales: number[];
  predictionScale: number;
  lookAheadScale: number;
}

export interface PitwallJointEvaluation {
  genome: PitwallJointGenome;
  result: MachineLapResult;
  /** Search score may keep a slightly illegal but fast candidate as a parent. */
  score: number;
  legal: boolean;
}

export interface PitwallJointOptimizationResult {
  seed: PitwallJointEvaluation;
  best: PitwallJointEvaluation;
  guide: PitwallJointEvaluation;
  evaluations: number;
  accepted: Array<{
    source: 'structured' | 'repair' | 'coupled';
    seconds: number;
    maxLaneDistance: number;
  }>;
}

export interface PitwallJointOptimizerOptions {
  maxEvaluations?: number;
  /** Deterministic RNG seed so a discovered reference is reproducible. */
  randomSeed?: number;
}

interface Dimension {
  name: string;
  step: number;
  min: number;
  max: number;
  get(genome: PitwallJointGenome): number;
  set(genome: PitwallJointGenome, value: number): void;
}

/**
 * Course-specific optimizer for Pitwall GP.
 *
 * This intentionally does not try to solve every circuit with one universal
 * trajectory. What is shared is only the evaluator/search machinery. Pitwall's
 * own line control points, speed windows and brake windows live here and are
 * optimized together against one objective: fastest completely legal full-state
 * flying lap. Human laps and target times are never inputs.
 *
 * Search is deliberately coupled rather than one-axis coordinate descent. A
 * faster steering or speed choice may be a few centimetres illegal by itself
 * but become the best legal solution when the trajectory moves with it. We keep
 * one soft-constrained guide for that purpose while `best` is legal at all times.
 */
export function optimizePitwallJoint(
  calibratedReference: readonly number[],
  options: PitwallJointOptimizerOptions = {},
): PitwallJointOptimizationResult {
  const maxEvaluations = Math.max(1, options.maxEvaluations ?? 40);
  const random = mulberry32(options.randomSeed ?? 0x51a7c0de);
  const seed = evaluatePitwallJoint(calibratedReference, createPitwallJointSeed());
  let best = seed;
  let guide = seed;
  let evaluations = 1;
  const accepted: PitwallJointOptimizationResult['accepted'] = [];

  const consider = (candidate: PitwallJointEvaluation, source: 'structured' | 'repair' | 'coupled') => {
    if (candidate.score < guide.score) guide = candidate;
    if (candidate.legal
      && candidate.result.lapSeconds !== undefined
      && best.result.lapSeconds !== undefined
      && candidate.result.lapSeconds + 0.001 < best.result.lapSeconds) {
      best = candidate;
      accepted.push({
        source,
        seconds: Number(candidate.result.lapSeconds.toFixed(3)),
        maxLaneDistance: Number(candidate.result.maxLaneDistance.toFixed(3)),
      });
    }
  };

  // First challenge the known steering boundary. A faster steering choice may
  // be a few centimetres illegal by itself; keep it long enough to try a
  // simultaneous trajectory repair instead of throwing the direction away.
  for (const predictionScale of [0.35, 0.25, 0.10, 0] as const) {
    if (evaluations >= maxEvaluations) break;
    const genome = cloneGenome(best.genome);
    genome.predictionScale = predictionScale;
    const candidate = evaluatePitwallJoint(calibratedReference, genome);
    evaluations += 1;
    consider(candidate, 'structured');
    if (!candidate.legal && candidate.result.completed && evaluations < maxEvaluations) {
      const repaired = repairLaneOverflow(candidate.genome, candidate.result);
      if (repaired) {
        const repairCandidate = evaluatePitwallJoint(calibratedReference, repaired);
        evaluations += 1;
        consider(repairCandidate, 'repair');
      }
    }
  }

  const dimensions = buildDimensions();
  let generation = 0;
  while (evaluations < maxEvaluations) {
    const temperature = Math.max(0.28, Math.pow(0.91, generation));
    const parent = generation % 3 === 2 ? guide : best;
    const genome = cloneGenome(parent.genome);
    const mutationCount = 2 + Math.floor(random() * 4);
    const used = new Set<number>();
    for (let mutation = 0; mutation < mutationCount; mutation++) {
      let dimensionIndex = Math.floor(random() * dimensions.length);
      for (let retry = 0; retry < 5 && used.has(dimensionIndex); retry++) {
        dimensionIndex = Math.floor(random() * dimensions.length);
      }
      used.add(dimensionIndex);
      const dimension = dimensions[dimensionIndex];
      const current = dimension.get(genome);
      const gaussian = normal(random);
      const next = clamp(
        current + gaussian * dimension.step * temperature,
        dimension.min,
        dimension.max,
      );
      dimension.set(genome, next);
    }

    const candidate = evaluatePitwallJoint(calibratedReference, genome);
    evaluations += 1;
    consider(candidate, 'coupled');

    if (!candidate.legal
      && candidate.result.completed
      && laneOverflow(candidate.result) <= 0.9
      && evaluations < maxEvaluations) {
      const repaired = repairLaneOverflow(candidate.genome, candidate.result);
      if (repaired) {
        const repairCandidate = evaluatePitwallJoint(calibratedReference, repaired);
        evaluations += 1;
        consider(repairCandidate, 'repair');
      }
    }
    generation += 1;
  }

  return { seed, best, guide, evaluations, accepted };
}

/**
 * Best completely legal genome discovered by the deterministic 48-evaluation
 * Pitwall joint search. It is a starting point, not a claimed machine limit.
 * Keeping it explicit makes CI replay the known result instead of spending
 * ~30 seconds rediscovering it on every commit.
 */
export function createPitwallJointSeed(): PitwallJointGenome {
  return {
    lineDeltas: [
      0,
      0,
      0.8889760259650835,
      0,
      0,
      0,
      0,
      0,
      0.5249289011078276,
      0,
      -0.8060421455078985,
    ],
    speedScales: [
      1,
      1.025587692063313,
      1,
      1,
      1,
      1,
      1,
      0.986788280788355,
      1,
      1,
    ],
    brakeScales: [0.80, 0.90, 1, 1, 1],
    predictionScale: 0.10,
    lookAheadScale: 1,
  };
}

export function createPitwallJointPilot(
  calibratedReference: readonly number[],
  genome: PitwallJointGenome,
): MachineLinePilot {
  const lanes = materializePitwallJointLine(calibratedReference, genome);
  const brakeWindows: MachineBrakeWindow[] = BRAKE_CENTERS.map((center, index) => ({
    center,
    halfWidth: index < 2 ? 0.010 : 0.016,
    scale: genome.brakeScales[index] ?? 1,
  }));
  const speedWindows: MachineSpeedWindow[] = SPEED_CENTERS.map((center, index) => ({
    center,
    halfWidth: 0.022,
    scale: genome.speedScales[index] ?? 1,
  }));
  return new MachineLinePilot('pitwall-gp', lanes, {
    brakeWindows,
    speedWindows,
    predictionScale: genome.predictionScale,
    lookAheadScale: genome.lookAheadScale,
  });
}

export function evaluatePitwallJoint(
  calibratedReference: readonly number[],
  genome: PitwallJointGenome,
): PitwallJointEvaluation {
  const pilot = createPitwallJointPilot(calibratedReference, genome);
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
    && result.maxLaneDistance <= REFERENCE_LANE_LIMIT;
  const overflow = laneOverflow(result);
  const illegalRatio = result.illegalSamples / Math.max(1, result.samples);

  const score = result.completed && result.lapSeconds !== undefined
    ? result.lapSeconds + overflow * 0.03 + illegalRatio * 0.5
    : 100 + (result.lapSeconds ?? 60) + overflow;

  return {
    genome: cloneGenome(genome),
    result,
    score,
    legal,
  };
}

export function materializePitwallJointLine(
  calibratedReference: readonly number[],
  genome: PitwallJointGenome,
): number[] {
  let lanes = buildMachineOptimalPitwallLine(calibratedReference);
  LINE_CONTROLS.forEach((control, index) => {
    const delta = genome.lineDeltas[index] ?? 0;
    if (Math.abs(delta) < 1e-9) return;
    lanes = applyBump(lanes, control.center, control.halfWidth, delta);
  });
  return lanes;
}

function repairLaneOverflow(genome: PitwallJointGenome, result: MachineLapResult): PitwallJointGenome | undefined {
  const overflow = laneOverflow(result);
  if (overflow <= 0 || overflow > 1.5) return undefined;
  let nearestIndex = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  LINE_CONTROLS.forEach((control, index) => {
    const distance = Math.abs(circularDelta(control.center, result.maxLaneProgress));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  if (nearestIndex < 0 || nearestDistance > 0.07) return undefined;

  const repaired = cloneGenome(genome);
  const direction = result.maxLaneOffset === 0 ? 0 : -Math.sign(result.maxLaneOffset);
  const magnitude = clamp(0.22 + overflow * 1.8, 0.22, 0.85);
  repaired.lineDeltas[nearestIndex] = clamp(
    repaired.lineDeltas[nearestIndex] + direction * magnitude,
    -1.6,
    1.6,
  );
  return repaired;
}

function buildDimensions(): Dimension[] {
  const dimensions: Dimension[] = [];
  for (let index = 0; index < LINE_CONTROLS.length; index++) {
    dimensions.push(arrayDimension(`line[${index}]`, 'lineDeltas', index, 0.55, -1.6, 1.6));
  }
  for (let index = 0; index < SPEED_CENTERS.length; index++) {
    dimensions.push(arrayDimension(`speed[${index}]`, 'speedScales', index, 0.030, 0.90, 1.10));
  }
  for (let index = 0; index < BRAKE_CENTERS.length; index++) {
    dimensions.push(arrayDimension(`brake[${index}]`, 'brakeScales', index, 0.08, 0.55, 1.10));
  }
  dimensions.push(scalarDimension('predictionScale', 'predictionScale', 0.10, 0, 0.75));
  dimensions.push(scalarDimension('lookAheadScale', 'lookAheadScale', 0.08, 0.78, 1.22));
  return dimensions;
}

function arrayDimension(
  name: string,
  key: 'lineDeltas' | 'speedScales' | 'brakeScales',
  index: number,
  step: number,
  min: number,
  max: number,
): Dimension {
  return {
    name,
    step,
    min,
    max,
    get: (genome) => genome[key][index],
    set: (genome, value) => { genome[key][index] = value; },
  };
}

function scalarDimension(
  name: string,
  key: 'predictionScale' | 'lookAheadScale',
  step: number,
  min: number,
  max: number,
): Dimension {
  return {
    name,
    step,
    min,
    max,
    get: (genome) => genome[key],
    set: (genome, value) => { genome[key] = value; },
  };
}

function applyBump(source: readonly number[], center: number, halfWidth: number, delta: number): number[] {
  const limit = REFERENCE_LANE_LIMIT - 0.25;
  return source.map((lane, index) => {
    const progress = index / source.length;
    const distance = Math.abs(circularDelta(progress, center));
    if (distance >= halfWidth) return lane;
    const phase = distance / halfWidth;
    const weight = 0.5 * (1 + Math.cos(Math.PI * phase));
    return clamp(lane + delta * weight, -limit, limit);
  });
}

function laneOverflow(result: MachineLapResult): number {
  return Math.max(0, result.maxLaneDistance - REFERENCE_LANE_LIMIT);
}

function cloneGenome(genome: PitwallJointGenome): PitwallJointGenome {
  return {
    lineDeltas: [...genome.lineDeltas],
    speedScales: [...genome.speedScales],
    brakeScales: [...genome.brakeScales],
    predictionScale: genome.predictionScale,
    lookAheadScale: genome.lookAheadScale,
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
  const u = Math.max(1e-9, random());
  const v = Math.max(1e-9, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function circularDelta(a: number, b: number): number {
  let delta = a - b;
  while (delta > 0.5) delta -= 1;
  while (delta < -0.5) delta += 1;
  return delta;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
