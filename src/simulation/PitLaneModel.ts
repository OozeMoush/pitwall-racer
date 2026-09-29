import {
  DEFAULT_PIT_LANE_DEFINITION,
  getActiveTrack,
  getTrackDefinition,
  sampleTrack,
  TRACK_LENGTH,
  type TrackId,
} from './TrackModel';

/** Default entry retained for tests/tools that need the Pitwall GP baseline. */
export const PIT_ENTRY_PROGRESS = DEFAULT_PIT_LANE_DEFINITION.entryProgress;
export const PIT_ENTRY_MIN_LANE_OFFSET = 8;
export const PIT_SERVICE_SECONDS = 2.5;

// The limiter is now a real pit-lane rule instead of the old kinematic
// conveyor speed. 80 km/h is close to modern F1 and still feels readable on
// the miniature circuit.
export const PIT_SPEED = 80 / 3.6;
export const PIT_LIMIT_START_T = 0.10;
export const PIT_LIMIT_END_T = 0.90;

const MAINLINE_REFERENCE_SPEED = 80;
const PIT_ENTRY_OFFSET = 11;
const PIT_ENTRY_RAMP_T = 0.08;
const PIT_EXIT_RAMP_T = 0.10;
const PIT_BOX_SLOT_START = 0.30;
const PIT_BOX_SLOT_SPACING = 0.028;
const PIT_PROJECTION_SPACING_METRES = 3;
// Sample a little beyond one road-mesh chord so detached 34 m pit offsets
// do not amplify small centreline tangent changes into visible metre-scale
// jumps on race-scale layouts such as Harbor Chicane.
const PIT_TRACK_TANGENT_METRES = 12;

export type PitPhase = 'IDLE' | 'TRANSIT_IN' | 'SERVICE' | 'TRANSIT_OUT' | 'DONE';

export interface PitStopState {
  phase: PitPhase;
  t: number;
  boxT: number;
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

export interface PitLaneProjection {
  t: number;
  distance: number;
  lateralOffset: number;
  pose: PitLanePose;
}

export function pitBoxTForSlot(slot: number): number {
  return clamp(
    PIT_BOX_SLOT_START + Math.max(0, Math.floor(slot)) * PIT_BOX_SLOT_SPACING,
    PIT_BOX_SLOT_START,
    0.50,
  );
}

export const PIT_BOX_T = pitBoxTForSlot(0);

export function createPitStopState(): PitStopState {
  return {
    phase: 'IDLE',
    t: 0,
    boxT: PIT_BOX_T,
    serviceRemaining: 0,
    tyreChanged: false,
  };
}

export function beginPitStop(
  boxT = PIT_BOX_T,
  initialT = 0,
): PitStopState {
  return {
    phase: 'TRANSIT_IN',
    t: clamp(initialT, 0, boxT),
    boxT,
    serviceRemaining: 0,
    tyreChanged: false,
  };
}

export function isPitActive(state: PitStopState): boolean {
  return state.phase !== 'IDLE' && state.phase !== 'DONE';
}

/**
 * A pit request is only committed when the car takes the physical pit-entry
 * side of the road. laneOffset is optional so the AI/autoplay model can still
 * use the same crossing gate while it is being migrated to physical entry.
 */
export function shouldEnterPit(
  previousProgress: number,
  currentProgress: number,
  distanceFromLine: number,
  requested: boolean,
  laneOffset?: number,
): boolean {
  if (!requested || distanceFromLine > 48) return false;
  if (laneOffset !== undefined && laneOffset < PIT_ENTRY_MIN_LANE_OFFSET) return false;
  const entryProgress = pitEntryProgress();
  return previousProgress < entryProgress && currentProgress >= entryProgress;
}

export function pitLaneLengthMetres(): number {
  return Math.max(
    120,
    getActiveTrack().pitLane?.lengthMetres ?? DEFAULT_PIT_LANE_DEFINITION.lengthMetres,
  );
}

export function pitEntryProgress(): number {
  return wrap01(
    getActiveTrack().pitLane?.entryProgress ?? DEFAULT_PIT_LANE_DEFINITION.entryProgress,
  );
}

export function pitExitProgress(): number {
  return wrap01(pitEntryProgress() + pitLaneSpanProgress());
}

export function pitStopDurationSeconds(): number {
  return pitLaneLengthMetres() / PIT_SPEED + PIT_SERVICE_SECONDS;
}

export function pitStopTimeLossEstimateSeconds(): number {
  return pitStopTimeLossForLaneLength(pitLaneLengthMetres());
}

/** Pure per-circuit estimate for strategy tooling; does not mutate active track. */
export function pitStopTimeLossEstimateSecondsFor(trackId: TrackId): number {
  const definition = getTrackDefinition(trackId);
  const laneLength = Math.max(
    120,
    definition.pitLane?.lengthMetres ?? DEFAULT_PIT_LANE_DEFINITION.lengthMetres,
  );
  return pitStopTimeLossForLaneLength(laneLength);
}

function pitStopTimeLossForLaneLength(laneLength: number): number {
  const fullPitSeconds = laneLength / PIT_SPEED + PIT_SERVICE_SECONDS;
  const mainlineSeconds = laneLength / MAINLINE_REFERENCE_SPEED;
  return Math.max(PIT_SERVICE_SECONDS, fullPitSeconds - mainlineSeconds);
}

/**
 * Time-based pit progression retained for AI cars. Their pose still follows
 * the exact same pit path and box allocation as the player.
 */
export function stepPitStop(state: PitStopState, dt: number): PitStopState {
  if (state.phase === 'IDLE' || state.phase === 'DONE') return state;

  if (state.phase === 'SERVICE') {
    const serviceRemaining = Math.max(0, state.serviceRemaining - dt);
    if (serviceRemaining > 0) return { ...state, serviceRemaining };
    return {
      ...state,
      phase: 'TRANSIT_OUT',
      serviceRemaining: 0,
      tyreChanged: true,
    };
  }

  const pitTRate = PIT_SPEED / pitLaneLengthMetres();
  const t = Math.min(1, state.t + pitTRate * dt);
  if (state.phase === 'TRANSIT_IN' && t >= state.boxT) {
    return {
      ...state,
      phase: 'SERVICE',
      t: state.boxT,
      serviceRemaining: PIT_SERVICE_SECONDS,
    };
  }

  if (state.phase === 'TRANSIT_OUT' && t >= 1) {
    return { ...state, phase: 'DONE', t: 1 };
  }

  return { ...state, t };
}

/**
 * Player pit progression is spatial, not clock-driven. The car only advances
 * through the state machine when it physically advances along the pit path.
 */
export function stepPlayerPitStop(
  state: PitStopState,
  dt: number,
  observedT: number,
): PitStopState {
  if (state.phase === 'IDLE' || state.phase === 'DONE') return state;

  if (state.phase === 'SERVICE') {
    return stepPitStop(state, dt);
  }

  const t = Math.max(state.t, clamp01(observedT));
  if (state.phase === 'TRANSIT_IN' && t >= state.boxT - 0.006) {
    return {
      ...state,
      phase: 'SERVICE',
      t: state.boxT,
      serviceRemaining: PIT_SERVICE_SECONDS,
    };
  }

  if (state.phase === 'TRANSIT_OUT' && t >= 0.995) {
    return { ...state, phase: 'DONE', t: 1 };
  }

  return { ...state, t };
}

export function pitLaneSpeedLimitActive(tInput: number): boolean {
  const t = clamp01(tInput);
  return t >= PIT_LIMIT_START_T && t <= PIT_LIMIT_END_T;
}

/**
 * Target used by the player's limiter/box assist. Entry and exit are allowed a
 * little more speed, but the regulated section is capped at 80 km/h. The final
 * metres into the box are progressively slowed so the only snap is the tiny
 * final docking correction.
 */
export function pitLaneTargetSpeed(state: PitStopState, tInput: number): number {
  if (state.phase === 'SERVICE') return 0;
  const t = clamp01(tInput);
  let target = pitLaneSpeedLimitActive(t) ? PIT_SPEED : 38;

  if (state.phase === 'TRANSIT_IN') {
    const remaining = state.boxT - t;
    if (remaining < 0.065) {
      const ratio = clamp(remaining / 0.065, 0, 1);
      target = Math.min(target, 3.5 + (PIT_SPEED - 3.5) * ratio);
    }
  }
  return Math.max(0, target);
}

export function pitLanePose(tInput: number): PitLanePose {
  const t = clamp01(tInput);
  const centre = pitLaneCentre(t);
  const epsilon = 0.0015;
  const before = pitLaneCentre(Math.max(0, t - epsilon));
  const after = pitLaneCentre(Math.min(1, t + epsilon));
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const heading = Math.hypot(dx, dy) > 0.0001
    ? Math.atan2(dy, dx)
    : centre.trackHeading;

  return {
    x: centre.x,
    y: centre.y,
    heading,
    raceProgress: centre.raceProgress,
    laneOffset: centre.laneOffset,
  };
}

export function pitLaneOffset(tInput: number): number {
  const t = clamp01(tInput);
  const inRamp = smoothstep(clamp01(t / PIT_ENTRY_RAMP_T));
  const outRamp = smoothstep(clamp01((1 - t) / PIT_EXIT_RAMP_T));
  const laneOffset = getActiveTrack().pitLane?.laneOffset
    ?? DEFAULT_PIT_LANE_DEFINITION.laneOffset;
  return PIT_ENTRY_OFFSET
    + (laneOffset - PIT_ENTRY_OFFSET) * Math.min(inRamp, outRamp);
}

export function projectPitLane(
  x: number,
  y: number,
  referenceT = 0,
): PitLaneProjection {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestT = clamp01(referenceT);
  let bestX = x;
  let bestY = y;

  const reference = clamp01(referenceT);
  const minT = Math.max(0, reference - 0.12);
  const maxT = Math.min(1, reference + 0.18);
  const range = Math.max(0.001, maxT - minT);
  const fullLaneSamples = Math.ceil(
    pitLaneLengthMetres() / PIT_PROJECTION_SPACING_METRES,
  );
  const samples = Math.max(24, Math.ceil(fullLaneSamples * range));

  let previousT = minT;
  let previous = pitLaneCentre(previousT);
  for (let i = 1; i <= samples; i++) {
    const nextT = minT + range * (i / samples);
    const next = pitLaneCentre(nextT);
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const lenSq = dx * dx + dy * dy;
    const segmentT = lenSq <= 0.000001
      ? 0
      : clamp(((x - previous.x) * dx + (y - previous.y) * dy) / lenSq, 0, 1);
    const px = previous.x + dx * segmentT;
    const py = previous.y + dy * segmentT;
    const distance = Math.hypot(x - px, y - py);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestT = previousT + (nextT - previousT) * segmentT;
      bestX = px;
      bestY = py;
    }
    previousT = nextT;
    previous = next;
  }

  const pose = pitLanePose(bestT);
  const nx = -Math.sin(pose.heading);
  const ny = Math.cos(pose.heading);
  return {
    t: bestT,
    distance: bestDistance,
    lateralOffset: (x - bestX) * nx + (y - bestY) * ny,
    pose,
  };
}

function pitLaneCentre(tInput: number): {
  x: number;
  y: number;
  raceProgress: number;
  laneOffset: number;
  trackHeading: number;
} {
  const t = clamp01(tInput);
  const unwrapped = pitEntryProgress() + pitLaneSpanProgress() * t;
  const raceProgress = wrap01(unwrapped);
  const laneOffset = pitLaneOffset(t);

  // Do not construct the pit centre from sampleTrack(progress, offset)
  // directly. That function uses the current polyline segment heading; at a
  // segment boundary a large 34 m offset can jump sideways even though the
  // centreline itself is visually smooth. The main road hides those tiny
  // tangent changes, but the detached pit lane amplifies them into zig-zags
  // and folded ribbon quads. Use a finite-distance centreline tangent instead.
  const centre = sampleTrack(raceProgress);
  const tangentProgress = PIT_TRACK_TANGENT_METRES / Math.max(1, TRACK_LENGTH);
  const before = sampleTrack(raceProgress - tangentProgress);
  const after = sampleTrack(raceProgress + tangentProgress);
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const trackHeading = Math.hypot(dx, dy) > 0.0001
    ? Math.atan2(dy, dx)
    : centre.heading;
  const nx = -Math.sin(trackHeading);
  const ny = Math.cos(trackHeading);

  return {
    x: centre.x + nx * laneOffset,
    y: centre.y + ny * laneOffset,
    raceProgress,
    laneOffset,
    trackHeading,
  };
}

function pitLaneSpanProgress(): number {
  return pitLaneLengthMetres() / Math.max(1, TRACK_LENGTH);
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
