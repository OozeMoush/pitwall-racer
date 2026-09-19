import RAPIER from '@dimforge/rapier2d-compat';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluatePitwallLearningPolicy } from '../../src/simulation/PitwallLearningEnvironment';
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
  samplePitwallLineResidual,
  validatePitwallLineResidualPolicyData,
  type PitwallLineResidualPolicyData,
} from '../../src/simulation/PitwallLineResidualPolicy';
import { OPTIMIZED_REFERENCE_LANES } from '../../src/simulation/ReferenceTrajectoryData';
import { TRACK_BARRIER_OFFSET } from '../../src/simulation/TrackLimitsModel';

await RAPIER.init();

const coarsePath = resolve(
  process.argv[2] ?? 'artifacts/pitwall-learning/policy-residual-pairs.json',
);
const finePath = resolve(
  process.argv[3] ?? 'artifacts/pitwall-learning/policy-residual-fine.json',
);
const linePath = resolve(
  process.argv[4] ?? 'artifacts/pitwall-learning/policy-line-residual.json',
);

const coarse = JSON.parse(await readFile(coarsePath, 'utf8')) as PitwallResidualPolicyData;
const fine = JSON.parse(await readFile(finePath, 'utf8')) as PitwallFineResidualPolicyData;
const line = JSON.parse(await readFile(linePath, 'utf8')) as PitwallLineResidualPolicyData;
validatePitwallResidualPolicyData(coarse);
validatePitwallFineResidualPolicyData(fine);
validatePitwallLineResidualPolicyData(line);

const genome = createPitwallAbsoluteSeed();
const baseLanes = materializePitwallAbsoluteLine(
  OPTIMIZED_REFERENCE_LANES['pitwall-gp'],
  genome,
);
const teacher = createPitwallMachineTeacherPolicyForLine(
  baseLanes,
  genome,
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

console.log(JSON.stringify({
  coarsePolicy: coarsePath,
  finePolicy: finePath,
  linePolicy: linePath,
  status: result.status,
  invalidReason: result.invalidReason ?? null,
  lapSeconds: result.lapSeconds === undefined ? null : Number(result.lapSeconds.toFixed(3)),
  preciseLapSeconds: result.preciseLapSeconds === undefined
    ? null
    : Number(result.preciseLapSeconds.toFixed(6)),
  forwardProgressMetres: Number(result.forwardProgressMetres.toFixed(1)),
  maxLaneDistance: Number(result.maxLaneDistance.toFixed(3)),
  peakSlideSeverity: Number(result.peakSlideSeverity.toFixed(3)),
  maxAbsoluteLaneResidualMetres: Number(Math.max(
    0,
    ...line.parameters.map(
      (parameter) => Math.abs(line.laneScale * Math.tanh(parameter)),
    ),
  ).toFixed(3)),
}, null, 2));

if (result.status !== 'COMPLETED') process.exitCode = 2;
