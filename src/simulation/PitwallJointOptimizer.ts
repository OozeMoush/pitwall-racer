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
  score: number;
  legal: boolean;
}

export interface PitwallJointOptimizationResult {
  seed: PitwallJointEvaluation;
  best: PitwallJointEvaluation;
  evaluations: number;
  accepted: Array<{ parameter: string; value: number; seconds: number }>;
}

export interface PitwallJointOptimizerOptions {
  maxEvaluations?: number;
  passes?: number;
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
 */
export function optimizePitwallJoint(
  calibratedReference: readonly number[],
  options: PitwallJointOptimizerOptions = {},
): PitwallJointOptimizationResult {
  const maxEvaluations = Math.max(1, options.maxEvaluations ?? 48);
  const passes = Math.max(1, options.passes ?? 2);
  const seedGenome = createPitwallJointSeed();
  const seed = evaluatePitwallJoint(calibratedReference, seedGenome);
  let best = seed;
  let evaluations = 1;
  const accepted: PitwallJointOptimizationResult['accepted'] = [];
  const dimensions = buildDimensions();

  for (let pass = 0; pass < passes && evaluations < maxEvaluations; pass++) {
    const stepScale = Math.pow(0.58, pass);
    for (const dimension of dimensions) {
      if (evaluations >= maxEvaluations) break;
      let localBest = best;
      let acceptedValue: number | undefined;
      for (const direction of [-1, 1] as const) {
        if (evaluations >= maxEvaluations) break;
        const candidateGenome = cloneGenome(best.genome);
        const current = dimension.get(candidateGenome);
        const next = clamp(current + dimension.step * stepScale * direction, dimension.min, dimension.max);
        if (Math.abs(next - current) < 1e-9) continue;
        dimension.set(candidateGenome, next);
        const candidate = evaluatePitwallJoint(calibratedReference, candidateGenome);
        evaluations += 1;
        if (candidate.score + 0.001 < localBest.score) {
          localBest = candidate;
          acceptedValue = next;
        }
      }
      if (localBest !== best) {
        best = localBest;
        accepted.push({
          parameter: dimension.name,
          value: Number(acceptedValue!.toFixed(4)),
          seconds: Number(best.result.lapSeconds!.toFixed(3)),
        });
      }
    }
  }

  return { seed, best, evaluations, accepted };
}

export function createPitwallJointSeed(): PitwallJointGenome {
  return {
    lineDeltas: Array.from({ length: LINE_CONTROLS.length }, () => 0),
    speedScales: Array.from({ length: SPEED_CENTERS.length }, () => 1),
    brakeScales: [0.80, 0.90, 1, 1, 1],
    predictionScale: 0.45,
    lookAheadScale: 1,
  };
}

export function evaluatePitwallJoint(
  calibratedReference: readonly number[],
  genome: PitwallJointGenome,
): PitwallJointEvaluation {
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
  const pilot = new MachineLinePilot('pitwall-gp', lanes, {
    brakeWindows,
    speedWindows,
    predictionScale: genome.predictionScale,
    lookAheadScale: genome.lookAheadScale,
  });
  const result = evaluateMachineFlyingLap({
    trackId: 'pitwall-gp',
    policy: (context) => pilot.control(context),
    maximumSeconds: 60,
  });
  const legal = result.completed
    && result.lapSeconds !== undefined
    && result.illegalSamples === 0
    && result.maxLaneDistance <= REFERENCE_LANE_LIMIT;
  const overflow = Math.max(0, result.maxLaneDistance - REFERENCE_LANE_LIMIT);
  const score = legal
    ? result.lapSeconds!
    : 1_000
      + (result.lapSeconds ?? 60)
      + result.illegalSamples * 0.02
      + overflow * 4;

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

function buildDimensions(): Dimension[] {
  const dimensions: Dimension[] = [];
  const count = Math.max(LINE_CONTROLS.length, SPEED_CENTERS.length, BRAKE_CENTERS.length);
  for (let index = 0; index < count; index++) {
    if (index < SPEED_CENTERS.length) {
      dimensions.push(arrayDimension(`speed[${index}]`, 'speedScales', index, 0.015, 0.93, 1.07));
    }
    if (index < LINE_CONTROLS.length) {
      dimensions.push(arrayDimension(`line[${index}]`, 'lineDeltas', index, 0.35, -1.6, 1.6));
    }
    if (index < BRAKE_CENTERS.length) {
      dimensions.push(arrayDimension(`brake[${index}]`, 'brakeScales', index, 0.05, 0.60, 1.08));
    }
    if (index === 0) {
      dimensions.push(scalarDimension('predictionScale', 'predictionScale', 0.04, 0.20, 0.70));
      dimensions.push(scalarDimension('lookAheadScale', 'lookAheadScale', 0.04, 0.82, 1.18));
    }
  }
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

function cloneGenome(genome: PitwallJointGenome): PitwallJointGenome {
  return {
    lineDeltas: [...genome.lineDeltas],
    speedScales: [...genome.speedScales],
    brakeScales: [...genome.brakeScales],
    predictionScale: genome.predictionScale,
    lookAheadScale: genome.lookAheadScale,
  };
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
