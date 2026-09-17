import RAPIER from '@dimforge/rapier2d-compat';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluatePitwallLearningPolicy } from '../../src/simulation/PitwallLearningEnvironment';
import {
  PitwallNeuralPolicy,
  type PitwallNeuralPolicyData,
} from '../../src/simulation/PitwallNeuralPolicy';

await RAPIER.init();

const input = resolve(process.argv[2] ?? 'artifacts/pitwall-learning/policy-teacher.json');
const data = JSON.parse(await readFile(input, 'utf8')) as PitwallNeuralPolicyData;
const policy = new PitwallNeuralPolicy(data);
const result = evaluatePitwallLearningPolicy(
  ({ observation }) => policy.act(observation),
  { captureFlyingLap: false },
);

console.log(JSON.stringify({
  policy: input,
  status: result.status,
  invalidReason: result.invalidReason ?? null,
  lapSeconds: result.lapSeconds === undefined ? null : Number(result.lapSeconds.toFixed(3)),
  forwardProgressMetres: Number(result.forwardProgressMetres.toFixed(1)),
  maxLaneDistance: Number(result.maxLaneDistance.toFixed(3)),
  peakSlideSeverity: Number(result.peakSlideSeverity.toFixed(3)),
}, null, 2));

if (result.status !== 'COMPLETED') process.exitCode = 2;
