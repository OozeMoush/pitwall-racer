import { describe, expect, it } from 'vitest';
import {
  REFERENCE_LANE_LIMIT,
  referenceExecutionForSkill,
  referenceLap,
  referenceRacingLineAsset,
} from './ReferenceDriverModel';
import { compoundPeakGrip } from './TireModel';
import { TRACKS } from './TrackModel';

describe('machine-limit reference driver', () => {
  it('derives a legal machine-limit lap for every circuit without human timing input', () => {
    const grip = compoundPeakGrip('SOFT', 'PUSH');
    const telemetry = TRACKS.map((track) => {
      const lap = referenceLap(track.id, grip);
      expect(lap.lapSeconds).toBeGreaterThan(15);
      expect(lap.lapSeconds).toBeLessThan(55);
      expect(lap.straightLimit).toBeGreaterThan(80);
      expect(lap.straightLimit).toBeLessThan(125);
      expect(Math.max(...lap.samples.map((sample) => Math.abs(sample.laneOffset))))
        .toBeLessThanOrEqual(REFERENCE_LANE_LIMIT + 0.001);
      expect(Math.max(...lap.samples.map((sample) => sample.targetSpeed)))
        .toBeLessThanOrEqual(lap.straightLimit + 0.01);
      return {
        track: track.id,
        seconds: Number(lap.lapSeconds.toFixed(3)),
        straightKmh: Math.round(lap.straightLimit * 3.6),
        minCornerKmh: Math.round(Math.min(...lap.samples.map((sample) => sample.targetSpeed)) * 3.6),
      };
    });

    console.log(`REFERENCE_DRIVER ${JSON.stringify(telemetry)}`);
  }, 20_000);

  it('exposes the current optimized CPU reference through the shared racing-line asset contract', () => {
    const asset = referenceRacingLineAsset(
      'pitwall-gp',
      compoundPeakGrip('SOFT', 'PUSH'),
    );

    expect(asset.source).toBe('OPTIMIZER');
    expect(asset.points).toHaveLength(320);
    expect(asset.points.every((point) => Number.isFinite(point.targetSpeed))).toBe(true);
  });

  it('makes tyre grip change the physical reference instead of changing engine power', () => {
    const soft = referenceLap('pitwall-gp', compoundPeakGrip('SOFT', 'PUSH'));
    const hard = referenceLap('pitwall-gp', compoundPeakGrip('HARD', 'PUSH'));

    expect(soft.lapSeconds).toBeLessThan(hard.lapSeconds);
    expect(Math.abs(soft.straightLimit - hard.straightLimit)).toBeLessThan(0.01);
  });

  it('keeps the professional field in a narrow execution band capped by the shared reference', () => {
    expect(referenceExecutionForSkill(1.118)).toBeGreaterThanOrEqual(0.985);
    expect(referenceExecutionForSkill(1.136)).toBeLessThanOrEqual(1.0);
    expect(referenceExecutionForSkill(1.136)).toBeGreaterThan(referenceExecutionForSkill(1.118));
    expect(referenceExecutionForSkill(1.155)).toBe(1.0);
  });
});
