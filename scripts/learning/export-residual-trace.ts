import RAPIER from '@dimforge/rapier2d-compat';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
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
const output = resolve(
  process.argv[3] ?? 'artifacts/pitwall-learning/optimized-trace.jsonl',
);
const residual = JSON.parse(
  await readFile(residualPath, 'utf8'),
) as PitwallResidualPolicyData;
validatePitwallResidualPolicyData(residual);

const basePolicy = createPitwallMachineTeacherPolicy();
const result = evaluatePitwallLearningPolicy(
  (context) => applyPitwallResidual(
    basePolicy(context),
    context.projection.progress,
    residual,
  ),
  { captureFlyingLap: true },
);

if (result.status !== 'COMPLETED' || result.lapSeconds === undefined) {
  throw new Error(`Optimized rollout failed: ${result.status} ${result.invalidReason ?? ''}`);
}

await mkdir(dirname(output), { recursive: true });
const rows = result.trace.map((sample) => JSON.stringify({
  observation: sample.observation,
  action: [sample.action.steer, sample.action.throttle, sample.action.brake],
  progress: sample.progress,
  laneOffset: sample.laneOffset,
  speed: sample.speed,
}));
await writeFile(output, `${rows.join('\n')}\n`, 'utf8');

console.log(JSON.stringify({
  residualPolicy: residualPath,
  output,
  samples: result.trace.length,
  lapSeconds: Number(result.lapSeconds.toFixed(3)),
  preciseLapSeconds: result.preciseLapSeconds === undefined
    ? null
    : Number(result.preciseLapSeconds.toFixed(6)),
  maxLaneDistance: Number(result.maxLaneDistance.toFixed(3)),
  peakSlideSeverity: Number(result.peakSlideSeverity.toFixed(3)),
}, null, 2));
