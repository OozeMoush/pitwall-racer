import type { EmpiricalLapEvidence } from './PaceBenchmarkModel';
import {
  DEEP_CUT_DISTANCE,
  TRACK_RUNOFF_HALF_WIDTH,
  trackDeepCutDistance,
  trackRunoffHalfWidth,
} from './TrackLimitsModel';
import type { Compound } from './TireModel';
import type { TrackId } from './TrackModel';

/**
 * Small mutable accumulator owned by a live player lap. It records only facts
 * needed to decide whether the resulting time is comparable to the clean
 * machine-limit reference; it never changes vehicle physics.
 */
export class PaceEvidenceAccumulator {
  private samples = 0;
  private deepCutSamples = 0;
  private grassSamples = 0;
  private maxTow = 0;
  private launchAffected = false;
  private recovered = false;
  private pitted = false;
  private compound: Compound = 'SOFT';
  private startWear = 0;

  begin(compound: Compound, startWear: number): void {
    this.samples = 0;
    this.deepCutSamples = 0;
    this.grassSamples = 0;
    this.maxTow = 0;
    this.launchAffected = false;
    this.recovered = false;
    this.pitted = false;
    this.compound = compound;
    this.startWear = clamp01(startWear);
  }

  sample(
    distanceFromLine: number,
    tow: number,
    hasLaunchEffect = false,
    progress?: number,
  ): void {
    this.samples += 1;
    const deepCut = progress === undefined ? DEEP_CUT_DISTANCE : trackDeepCutDistance(progress);
    const runoff = progress === undefined ? TRACK_RUNOFF_HALF_WIDTH : trackRunoffHalfWidth(progress);
    if (distanceFromLine > deepCut) this.deepCutSamples += 1;
    if (distanceFromLine >= runoff) this.grassSamples += 1;
    this.maxTow = Math.max(this.maxTow, Math.max(0, tow));
    this.launchAffected ||= hasLaunchEffect;
  }

  markRecovered(): void {
    this.recovered = true;
  }

  markPitted(): void {
    this.pitted = true;
  }

  finish(trackId: TrackId, seconds: number, endWear: number): EmpiricalLapEvidence {
    const denominator = Math.max(1, this.samples);
    return {
      trackId,
      seconds,
      compound: this.compound,
      startWear: this.startWear,
      endWear: clamp01(endWear),
      deepCutRatio: this.deepCutSamples / denominator,
      grassRatio: this.grassSamples / denominator,
      maxTow: this.maxTow,
      launchAffected: this.launchAffected,
      recovered: this.recovered,
      pitted: this.pitted,
    };
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
