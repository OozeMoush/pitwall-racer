export const REPRESENTATIVE_SLIDE_PENALTY_SECONDS = 8;

export interface TyreSlideState {
  stress: number;
  remaining: number;
  cooldown: number;
  intensity: number;
  direction: -1 | 0 | 1;
  eventIndex: number;
  seed: number;
}

export interface TyreSlideInput {
  wear: number;
  speed: number;
  steer: number;
  throttle: number;
}

export interface TyreSlideStep {
  state: TyreSlideState;
  severity: number;
  direction: -1 | 0 | 1;
  triggered: boolean;
}

/**
 * Wear controls how often a rear-slide event is likely to happen. Compound
 * peak grip is intentionally not part of this signal: a fresh Hard tyre should
 * be slower in a corner, but it must not behave like a worn-out Soft simply
 * because its nominal grip is lower.
 */
export function tyreSlideRisk(wear: number): number {
  const aged = clamp01((wear - 0.10) / 0.78);
  return Math.pow(aged, 1.25);
}

export function createTyreSlideState(seed = 0): TyreSlideState {
  return {
    stress: 0,
    remaining: 0,
    cooldown: 0,
    intensity: 0,
    direction: 0,
    eventIndex: 0,
    seed,
  };
}

/**
 * Arcade instability rather than slip-angle simulation. High-speed steering
 * builds a hidden pressure meter. The important detail is that pressure now
 * survives the short straight between corners. The previous implementation
 * bled the meter dry in a few seconds, so a medium tyre could complete a long
 * stint without ever crossing the event threshold unless one corner was held
 * at near-full lock for several seconds.
 *
 * Worn tyres therefore accumulate several ordinary loaded corners and then
 * produce one short, obvious rear step. Fresh tyres still need unrealistic
 * abuse before the meter can fill, while 40-60% worn rubber should produce
 * occasional events in normal race driving.
 */
export function stepTyreSlide(state: TyreSlideState, input: TyreSlideInput, dt: number): TyreSlideStep {
  const safeDt = Math.max(0, Math.min(0.1, dt));
  const cooldown = Math.max(0, state.cooldown - safeDt);

  if (state.remaining > 0) {
    const remaining = Math.max(0, state.remaining - safeDt);
    const severity = state.intensity * clamp01(remaining / 0.12);
    return {
      state: {
        ...state,
        remaining,
        cooldown,
        stress: 0,
        direction: remaining > 0 ? state.direction : 0,
      },
      severity,
      direction: state.direction,
      triggered: false,
    };
  }

  const speedDemand = clamp01((input.speed - 42) / 58);
  const steerDemand = clamp01((Math.abs(input.steer) - 0.30) / 0.62);
  const driverDemand = speedDemand * steerDemand * (0.52 + clamp01(input.throttle) * 0.48);
  const risk = tyreSlideRisk(input.wear);

  if (cooldown > 0 || driverDemand < 0.015) {
    return {
      state: {
        ...state,
        // Preserve accumulated load between corners. This is intentionally a
        // very slow leak: long straights still calm the tyre, but a two-second
        // straight no longer erases the previous corner completely.
        stress: Math.max(0, state.stress - safeDt * 0.008),
        cooldown,
        direction: 0,
      },
      severity: 0,
      direction: 0,
      triggered: false,
    };
  }

  const stress = state.stress + driverDemand * (0.012 + risk * 0.42) * safeDt;
  const threshold = eventThreshold(state.eventIndex, state.seed);
  if (stress < threshold) {
    return {
      state: { ...state, stress, cooldown, direction: 0 },
      severity: 0,
      direction: 0,
      triggered: false,
    };
  }

  const steerSign: -1 | 1 = input.steer >= 0 ? 1 : -1;
  const direction: -1 | 1 = steerSign === 1 ? -1 : 1;
  const intensity = 0.84 + risk * 0.16;
  const remaining = 0.38 + risk * 0.12;
  const next: TyreSlideState = {
    ...state,
    stress: 0,
    remaining,
    cooldown: 0.50 + (1 - risk) * 0.18,
    intensity,
    direction,
    eventIndex: state.eventIndex + 1,
  };
  return { state: next, severity: intensity, direction, triggered: true };
}

function eventThreshold(eventIndex: number, seed: number): number {
  const wave = Math.sin((eventIndex + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  const unit = wave - Math.floor(wave);
  return 0.68 + unit * 0.22;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
