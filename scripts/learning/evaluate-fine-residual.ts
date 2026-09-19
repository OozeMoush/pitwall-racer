import RAPIER from '@dimforge/rapier2d-compat';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluatePitwallLearningPolicy } from '../../src/simulation/PitwallLearningEnvironment';
import { createPitwallMachineTeacherPolicy } from '../../src/simulation/PitwallMachineTeacherPolicy';
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

await RAPIER.init();

const coarsePath = resolve(
  process.argv[2] ?? 'artifacts/pitwall-learning/policy-residual-pairs.json',
);
const finePath = resolve(
  process.argv[3] ?? 'artifacts/pitwall-learning/policy-residual-fine.json',
);

const coarse = JSON.parse(
  await readFile(coarsePath, 'utf8'),
) as PitwallResidualPolicyData;
const fine = JSON.parse(
  await readFile(finePath, 'utf8'),
) as PitwallFineResidualPolicyData;
validatePitwallResidualPolicyData(coarse);
validatePitwallFineResidualPolicyData(fine);

const teacher = createPitwallMachineTeacherPolicy();
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
  basePolicy: 'machine-only-pitwall-absolute-seed',
  coarsePolicy: coarsePath,
  finePolicy: finePath,
  status: result.status,
  invalidReason: result.invalidReason ?? null,
  lapSeconds: result.lapSeconds === undefined ? null : Number(result.lapSeconds.toFixed(3)),
  preciseLapSeconds: result.preciseLapSeconds === undefined
    ? null
    : Number(result.preciseLapSeconds.toFixed(6)),
  forwardProgressMetres: Number(result.forwardProgressMetres.toFixed(1)),
  maxLaneDistance: Number(result.maxLaneDistance.toFixed(3)),
  peakSlideSeverity: Number(result.peakSlideSeverity.toFixed(3)),
}, null, 2));

if (result.status !== 'COMPLETED') process.exitCode = 2;
