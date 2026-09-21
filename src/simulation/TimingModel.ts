export interface TimingState {
  raceTime: number;
  lapStartTime: number;
  currentLapTime: number;
  lastLapTime?: number;
  bestLapTime?: number;
  deltaToBest?: number;
}

export function createTiming(): TimingState {
  return { raceTime: 0, lapStartTime: 0, currentLapTime: 0 };
}

export function stepTiming(state: TimingState, dt: number): TimingState {
  const raceTime = state.raceTime + dt;
  return {
    ...state,
    raceTime,
    currentLapTime: raceTime - state.lapStartTime,
  };
}

export function completeLap(state: TimingState, valid = true): TimingState {
  const lapTime = state.raceTime - state.lapStartTime;
  const previousBest = state.bestLapTime;

  if (!valid) {
    return {
      ...state,
      lapStartTime: state.raceTime,
      currentLapTime: 0,
      lastLapTime: lapTime,
      bestLapTime: previousBest,
      deltaToBest: undefined,
    };
  }

  const bestLapTime = previousBest === undefined ? lapTime : Math.min(previousBest, lapTime);
  return {
    ...state,
    lapStartTime: state.raceTime,
    currentLapTime: 0,
    lastLapTime: lapTime,
    bestLapTime,
    deltaToBest: previousBest === undefined ? undefined : lapTime - previousBest,
  };
}

export function formatLapTime(seconds?: number): string {
  if (seconds === undefined) return '--:--.---';
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds - minutes * 60;
  return `${minutes}:${remaining.toFixed(3).padStart(6, '0')}`;
}
