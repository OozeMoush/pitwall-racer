import RAPIER from '@dimforge/rapier2d-compat';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import {
  createPitwallAbsolutePilot,
  createPitwallAbsoluteSeed,
} from '../../src/simulation/PitwallAbsoluteOptimizer';
import { evaluatePitwallLearningPolicy } from '../../src/simulation/PitwallLearningEnvironment';
import { installReferenceLineCalibration } from '../../src/simulation/ReferenceLineCalibration';
import { OPTIMIZED_REFERENCE_LANES } from '../../src/simulation/ReferenceTrajectoryData';

await RAPIER.init();
installReferenceLineCalibration();

const output = resolve(process.argv[2] ?? 'artifacts/pitwall-learning/teacher.jsonl');
await mkdir(dirname(output), { recursive: true });

const teacher = createPitwallAbsolutePilot(
  OPTIMIZED_REFERENCE_LANES['pitwall-gp'],
  createPitwallAbsoluteSeed(),
);
const result = evaluatePitwallLearningPolicy((context) => {
  const speed = context.state.speed;
  const control = teacher.control({
    state: {
      x: context.state.x,
      y: context.state.y,
      heading: context.state.heading,
      vx: Math.cos(context.state.heading) * speed,
      vy: Math.sin(context.state.heading) * speed,
      yawRate: context.state.yawRate,
    },
    projection: context.projection,
    elapsedSeconds: context.elapsedSeconds,
    completedLaps: context.completedLaps,
  });
  return {
    steer: control.steer,
    longitudinal: control.throttle - control.brake,
  };
}, { captureFlyingLap: true });

if (result.status !== 'COMPLETED' || result.lapSeconds === undefined) {
  throw new Error(`Teacher rollout failed: ${result.status} ${result.invalidReason ?? ''}`);
}

const rows = result.trace.map((sample) => JSON.stringify({
  observation: sample.observation,
  action: [sample.action.steer, sample.action.longitudinal],
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
