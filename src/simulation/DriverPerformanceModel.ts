import type { DriverState } from './RaceModel';

export interface DriverPerformanceProfile {
  /** Average fraction of an ideal clean-air execution. */
  pace: number;
  /** Smooth race-to-race / lap-to-lap variation around pace. */
  consistency: number;
  /** How much ideal technical-corner performance the driver can reproduce. */
  precision: number;
}

export interface DriverPerformanceSample {
  profile: DriverPerformanceProfile;
  form: number;
  paceFactor: number;
  technicalFactor: number;
  executionFactor: number;
}

const PROFILES: Record<string, DriverPerformanceProfile> = {
  APEX:  { pace: 0.9930, consistency: 0.0055, precision: 0.996 },
  ORBIT: { pace: 0.9905, consistency: 0.0060, precision: 0.994 },
  NOVA:  { pace: 0.9900, consistency: 0.0063, precision: 0.993 },
  ZEN:   { pace: 0.9890, consistency: 0.0065, precision: 0.992 },
  KITE:  { pace: 0.9875, consistency: 0.0070, precision: 0.991 },
  VOLT:  { pace: 0.9825, consistency: 0.0080, precision: 0.987 },
  RIFT:  { pace: 0.9775, consistency: 0.0090, precision: 0.984 },
};

/**
 * Driver identity should not be white noise.
 *
 * Each CPU owns a mean pace, consistency amplitude and technical precision.
 * The live form wave is deterministic and continuous in race distance, so the
 * car can have a slightly stronger or weaker sector/lap without twitching from
 * one physics frame to the next.
 */
export function driverPerformanceAt(
  driver: Pick<DriverState, 'id' | 'name' | 'skill' | 'lap'>,
  progress: number,
  severity: number,
): DriverPerformanceSample {
  const profile = driverPerformanceProfile(driver);
  const distance = Math.max(0, driver.lap) + wrap01(progress);
  const phase = hash01(driver.id || driver.name);
  const slowWave = Math.sin((distance / 2.9 + phase) * Math.PI * 2);
  const sectionWave = Math.sin((distance * 2.15 + phase * 1.73 + 0.19) * Math.PI * 2);
  const form = slowWave * 0.68 + sectionWave * 0.32;

  const paceFactor = profile.pace + profile.consistency * form;
  const technicalLoss =
    (1 - profile.precision) * clamp01((severity - 0.08) / 0.92);
  const technicalFactor = 1 - technicalLoss;

  return {
    profile,
    form,
    paceFactor,
    technicalFactor,
    // PLAYER BEST is a ceiling for requested execution, not an absolute lap
    // time ceiling. Tow, tyres, braking phase and physical carry can still let
    // a real CPU lap beat the recorded time.
    executionFactor: clamp(paceFactor * technicalFactor, 0.94, 0.9995),
  };
}

export function driverPerformanceProfile(
  driver: Pick<DriverState, 'name' | 'skill'>,
): DriverPerformanceProfile {
  const named = PROFILES[driver.name];
  if (named) return named;

  // Stable fallback for tests/custom drivers: preserve the old skill ordering
  // without requiring every caller to register a named profile.
  const t = clamp01((driver.skill - 1.118) / (1.136 - 1.118));
  return {
    pace: lerp(0.9775, 0.9930, t),
    consistency: lerp(0.0090, 0.0055, t),
    precision: lerp(0.984, 0.996, t),
  };
}

function hash01(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
