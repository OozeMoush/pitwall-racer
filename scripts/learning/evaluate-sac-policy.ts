import RAPIER from '@dimforge/rapier2d-compat';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluatePitwallLearningPolicy } from '../../src/simulation/PitwallLearningEnvironment';
import {
  PitwallSacPolicy,
  type PitwallSacPolicyData,
} from '../../src/simulation/PitwallSacPolicy';

await RAPIER.init();

const input = resolve(
  process.argv[2] ?? 'artifacts/pitwall-learning/policy-sac.json',
);
const data = JSON.parse(
  await readFile(input, 'utf8'),
) as PitwallSacPolicyData;
const policy = new PitwallSacPolicy(data);
const result = evaluatePitwallLearningPolicy(
  (context) => policy.act(context.observation),
  { captureFlyingLap: false },
);

console.log(JSON.stringify({
  policy: input,
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
}, null, 2));

if (result.status !== 'COMPLETED') process.exitCode = 2;
