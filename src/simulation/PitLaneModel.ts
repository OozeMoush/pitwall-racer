import { sampleTrack, TRACK_LENGTH } from './TrackModel';

export const PIT_ENTRY_PROGRESS = 0.91;
export const PIT_EXIT_PROGRESS = 0.075;
export const PIT_BOX_T = 0.47;
export const PIT_SERVICE_SECONDS = 2.5;
// Still faster than a literal modern-F1 80 km/h limiter because the circuit is
// intentionally miniature, but no longer a ~200 km/h drive-through. This keeps
// an extra stop meaningful without making a two-stop strategy automatically
// hopeless on a 25-30 second lap.
export const PIT_SPEED = 40;

const PIT_SPAN = (1 - PIT_ENTRY_PROGRESS) + PIT_EXIT_PROGRESS;
// Approximate the time the same section would consume at racing speed. Strategy
// tools care about *time lost versus staying out*, not the full clock time spent
// traversing the pit lane.
const MAINLINE_REFERENCE_SPEED = 80;

export type PitPhase = 'IDLE' | 'TRANSIT_IN' | 'SERVICE' | 'TRANSIT_OUT' | 'DONE';

export interface PitStopState {
  phase: PitPhase;
  t: number;
  serviceRemaining: number;
  tyreChanged: boolean;
}

export interface PitLanePose {
  x: number;
  y: number;
  heading: number;
  raceProgress: number;
  laneOffset: number;
}

export function createPitStopState(): PitStopState {
  return { phase: 'IDLE', t: 0, serviceRemaining: 0, tyreChanged: false };
}

export function beginPitStop(): PitStopState {
  return { phase: 'TRANSIT_IN', t: 0, serviceRemaining: 0, tyreChanged: false };
}

export function isPitActive(state: PitStopState): boolean {
  return state.phase !== 'IDLE' && state.phase !== 'DONE';
}

export function shouldEnterPit(
  previousProgress: number,
  currentProgress: number,
  distanceFromLine: number,
  requested: boolean,
): boolean {
  if (!requested || distanceFromLine > 48) return false;
  return previousProgress < PIT_ENTRY_PROGRESS && currentProgress >= PIT_ENTRY_PROGRESS;
}

export function pitStopDurationSeconds(): number {
  return (PIT_SPAN * TRACK_LENGTH) / PIT_SPEED + PIT_SERVICE_SECONDS;
}

export function pitStopTimeLossEstimateSeconds(): number {
  const mainlineSeconds = (PIT_SPAN * TRACK_LENGTH) / MAINLINE_REFERENCE_SPEED;
  return Math.max(PIT_SERVICE_SECONDS, pitStopDurationSeconds() - mainlineSeconds);
}

export function stepPitStop(state: PitStopState, dt: number): PitStopState {
  if (state.phase === 'IDLE' || state.phase === 'DONE') return state;

  if (state.phase === 'SERVICE') {
    const serviceRemaining = Math.max(0, state.serviceRemaining - dt);
    if (serviceRemaining > 0) return { ...state, serviceRemaining };
    return {
      phase: 'TRANSIT_OUT',
      t: state.t,
      serviceRemaining: 0,
      tyreChanged: true,
    };
  }

  // TRACK_LENGTH is a live binding because the circuit can be selected before
  // race construction. Player and AI both step this exact same state machine,
  // so neither side receives a hidden pit-lane timing advantage.
  const pitTRate = PIT_SPEED / Math.max(1, PIT_SPAN * TRACK_LENGTH);
  const t = Math.min(1, state.t + pitTRate * dt);
  if (state.phase === 'TRANSIT_IN' && t >= PIT_BOX_T) {
    return {
      phase: 'SERVICE',
      t: PIT_BOX_T,
      serviceRemaining: PIT_SERVICE_SECONDS,
      tyreChanged: state.tyreChanged,
    };
  }

  if (state.phase === 'TRANSIT_OUT' && t >= 1) {
    return { ...state, phase: 'DONE', t: 1 };
  }

  return { ...state, t };
}

export function pitLanePose(tInput: number): PitLanePose {
  const t = clamp01(tInput);
  const unwrapped = PIT_ENTRY_PROGRESS + PIT_SPAN * t;
  const raceProgress = unwrapped >= 1 ? unwrapped - 1 : unwrapped;
  const laneOffset = pitLaneOffset(t);
  const point = sampleTrack(raceProgress, laneOffset);
  return { ...point, raceProgress, laneOffset };
}

export function pitLaneOffset(tInput: number): number {
  const t = clamp01(tInput);
  const minOffset = 15;
  const maxOffset = 42;
  const inRamp = smoothstep(clamp01(t / 0.2));
  const outRamp = smoothstep(clamp01((1 - t) / 0.22));
  return minOffset + (maxOffset - minOffset) * Math.min(inRamp, outRamp);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
