import RAPIER from '@dimforge/rapier2d-compat';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { evaluatePitwallLearningPolicy } from '../../src/simulation/PitwallLearningEnvironment';
import { createPitwallMachineTeacherPolicy } from '../../src/simulation/PitwallMachineTeacherPolicy';

await RAPIER.init();

const output = resolve(process.argv[2] ?? 'artifacts/pitwall-learning/teacher.jsonl');
await mkdir(dirname(output), { recursive: true });

const result = evaluatePitwallLearningPolicy(
  createPitwallMachineTeacherPolicy(),
  { captureFlyingLap: true },
);

if (result.status !== 'COMPLETED' || result.lapSeconds === undefined) {
  throw new Error(`Teacher rollout failed: ${result.status} ${result.invalidReason ?? ''}`);
}

const rows = result.trace.map((sample) => JSON.stringify({
  observation: sample.observation,
  action: [sample.action.steer, sample.action.throttle, sample.action.brake],
  progress: sample.progress,
  laneOffset: sample.laneOffset,
  speed: sample.speed,
}));
await writeFile(output, `${rows.join('\n')}\n`, 'utf8');

const metaPath = extname(output) === '.jsonl'
  ? output.slice(0, -'.jsonl'.length) + '.meta.json'
  : `${output}.meta.json`;
await writeFile(metaPath, `${JSON.stringify({
  source: 'machine-only-pitwall-absolute-seed',
  actionSpace: ['steer', 'throttle', 'brake'],
  samples: result.trace.length,
  lapSeconds: result.lapSeconds,
  maxLaneDistance: result.maxLaneDistance,
  peakSlideSeverity: result.peakSlideSeverity,
  humanTelemetryUsed: false,
}, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  output,
  metaPath,
  samples: result.trace.length,
  lapSeconds: Number(result.lapSeconds.toFixed(3)),
}, null, 2));
