import { describe, it } from 'vitest';
import { referenceLap } from './ReferenceDriverModel';
import { compoundPeakGrip } from './TireModel';
import { TRACKS } from './TrackModel';

describe('reference trajectory bake data', () => {
  it('prints deterministic optimized lane samples', () => {
    const grip = compoundPeakGrip('SOFT', 'PUSH');
    for (const track of TRACKS) {
      const lap = referenceLap(track.id, grip);
      const lanes = lap.samples.map((sample) => Number(sample.laneOffset.toFixed(4)));
      console.log(`REFERENCE_BAKE ${track.id} ${JSON.stringify(lanes)}`);
    }
  }, 20_000);
});
