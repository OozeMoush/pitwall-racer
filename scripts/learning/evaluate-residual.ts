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

await RAPIER.init();

const residualPath = resolve(
  process.argv[2] ?? 'artifacts/pitwall-learning/policy-residual.json',
);
const residualData = JSON.parse(
  await readFile(residualPath, 'utf8'),
) as PitwallResidualPolicyData;
validatePitwallResidualPolicyData(residualData);

const basePolicy = createPitwallMachineTeacherPolicy();
const result = evaluatePitwallLearningPolicy(
  (context) => applyPitwallResidual(
    basePolicy(context),
    context.projection.progress,
    residualData,
  ),
  { captureFlyingLap: false },
);

console.log(JSON.stringify({
  basePolicy: 'machine-only-pitwall-absolute-seed',
  residualPolicy: residualPath,
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
