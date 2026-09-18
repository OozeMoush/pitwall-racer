import RAPIER from '@dimforge/rapier2d-compat';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluatePitwallLearningPolicy } from '../../src/simulation/PitwallLearningEnvironment';
import {
  PitwallNeuralPolicy,
  type PitwallNeuralPolicyData,
} from '../../src/simulation/PitwallNeuralPolicy';
import {
  applyPitwallResidual,
  validatePitwallResidualPolicyData,
  type PitwallResidualPolicyData,
} from '../../src/simulation/PitwallResidualPolicy';

await RAPIER.init();

const basePath = resolve(process.argv[2] ?? 'artifacts/pitwall-learning/policy-teacher.json');
const residualPath = resolve(process.argv[3] ?? 'artifacts/pitwall-learning/policy-residual.json');

const baseData = JSON.parse(await readFile(basePath, 'utf8')) as PitwallNeuralPolicyData;
const residualData = JSON.parse(await readFile(residualPath, 'utf8')) as PitwallResidualPolicyData;
validatePitwallResidualPolicyData(residualData);

const basePolicy = new PitwallNeuralPolicy(baseData);
const result = evaluatePitwallLearningPolicy(
  ({ observation, projection }) => applyPitwallResidual(
    basePolicy.act(observation),
    projection.progress,
    residualData,
  ),
  { captureFlyingLap: false },
);

console.log(JSON.stringify({
  basePolicy: basePath,
  residualPolicy: residualPath,
  status: result.status,
  invalidReason: result.invalidReason ?? null,
  lapSeconds: result.lapSeconds === undefined ? null : Number(result.lapSeconds.toFixed(3)),
  forwardProgressMetres: Number(result.forwardProgressMetres.toFixed(1)),
  maxLaneDistance: Number(result.maxLaneDistance.toFixed(3)),
  peakSlideSeverity: Number(result.peakSlideSeverity.toFixed(3)),
}, null, 2));

if (result.status !== 'COMPLETED') process.exitCode = 2;
