import { TRACK_LENGTH } from './TrackModel';

export interface AeroCarPose {
  id: string;
  lap: number;
  progress: number;
  laneOffset: number;
}

export interface SharedAeroEffect {
  tow: number;
  dirtyAir: number;
  sourceId?: string;
}

const MAX_WAKE_DISTANCE = 78;
const MIN_WAKE_DISTANCE = 6;
const TOW_HALF_WIDTH = 24;
const DIRTY_HALF_WIDTH = 11;
const SIDE_BY_SIDE_LONGITUDINAL = 18;
const SIDE_BY_SIDE_LATERAL = 7;

// Tow is deliberately stronger than the first racecraft pass. The chassis
// converts this coefficient into extra power, so 20-30 m behind another car
// now produces a clearly visible straight-line gain without becoming a magic
// overtake button. Player and AI consume the same value.
export const MAX_TOW_STRENGTH = 0.30;
export const MAX_TOW_POWER_BOOST = 0.16;
export const MAX_TOW_DRAG_REDUCTION = 0.45;
const DIRTY_AIR_STRENGTH = 0.28;

/**
 * Game-facing aero wake shared by player and AI.
 *
 * Aero is a local physical effect, not a race-classification effect. A lapped
 * car that is physically 25 m in front should still punch the same hole in the
 * air as the leader. Therefore longitudinal wake distance is calculated from
 * wrapped track progress, while lap count is deliberately ignored here.
 */
export function aerodynamicEffect(
  subject: AeroCarPose,
  traffic: readonly AeroCarPose[],
): SharedAeroEffect {
  let tow = 0;
  let dirtyAir = 0;
  let sourceId: string | undefined;
  let strongest = 0;

  for (const other of traffic) {
    if (other.id === subject.id) continue;
    const longitudinal = forwardTrackDistance(subject.progress, other.progress);
    if (longitudinal <= MIN_WAKE_DISTANCE || longitudinal > MAX_WAKE_DISTANCE) continue;

    const lateral = Math.abs(other.laneOffset - subject.laneOffset);
    if (longitudinal < SIDE_BY_SIDE_LONGITUDINAL && lateral > SIDE_BY_SIDE_LATERAL) continue;

    const longitudinalStrength = clamp01(
      (MAX_WAKE_DISTANCE - longitudinal) / (MAX_WAKE_DISTANCE - MIN_WAKE_DISTANCE),
    );
    // Tow should be a racecraft tool the player can actually feel. Keep dirty
    // air linear, but make the slipstream useful across more of the wake and
    // reserve 100% for being close and properly aligned.
    const towLongitudinalStrength = Math.pow(longitudinalStrength, 0.78);
    const towStrength = MAX_TOW_STRENGTH
      * towLongitudinalStrength
      * clamp01(1 - lateral / TOW_HALF_WIDTH);
    const dirtyStrength = DIRTY_AIR_STRENGTH
      * longitudinalStrength
      * clamp01(1 - lateral / DIRTY_HALF_WIDTH);

    tow = Math.max(tow, towStrength);
    dirtyAir = Math.max(dirtyAir, dirtyStrength);
    const combined = towStrength + dirtyStrength;
    if (combined > strongest) {
      strongest = combined;
      sourceId = other.id;
    }
  }

  return { tow, dirtyAir, sourceId };
}

export function normalizedTowStrength(tow: number): number {
  return clamp01(Math.max(0, tow) / MAX_TOW_STRENGTH);
}

export function towPowerBoost(tow: number): number {
  return normalizedTowStrength(tow) * MAX_TOW_POWER_BOOST;
}

export function towDragMultiplier(tow: number): number {
  return 1 - normalizedTowStrength(tow) * MAX_TOW_DRAG_REDUCTION;
}

function forwardTrackDistance(fromProgress: number, toProgress: number): number {
  const from = wrap01(fromProgress);
  const to = wrap01(toProgress);
  return wrap01(to - from) * TRACK_LENGTH;
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
