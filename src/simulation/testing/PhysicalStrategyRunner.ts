import { RapierRacePhysics } from '../RapierRacePhysics';
import { createAiField, stepAiField, type AiPitPlanStop, type DriverState } from '../RaceModel';
import { createTire, type Compound } from '../TireModel';
import { DEEP_CUT_DISTANCE } from '../TrackLimitsModel';
import { getActiveTrack, projectTrackNear, sampleTrack, setActiveTrack, type TrackId } from '../TrackModel';
import { createVehicle } from '../VehicleModel';

export interface PhysicalStrategyPlan {
  name: string;
  start: Compound;
  stops: readonly AiPitPlanStop[];
}

export interface PhysicalStrategyOptions {
  trackId: TrackId;
  totalLaps: number;
  plan: PhysicalStrategyPlan;
  /** Fixed schedules isolate tyre/stop economics from adaptive CPU decisions. */
  fixedStops?: boolean;
  start?: { lap: number; progress: number; speed: number; wear?: number };
  rivals?: DriverState[];
  maxSeconds?: number;
}

/** Test-only authoritative benchmark. Caller initializes Rapier first. */
export function runPhysicalStrategy(options: PhysicalStrategyOptions) {
  const originalTrack = getActiveTrack().id;
  setActiveTrack(options.trackId);
  const dt = 1 / 60;
  const start = options.start ?? { lap: 1, progress: 0.02, speed: 72 };
  const base = createAiField(undefined, options.totalLaps)[0];
  const first = options.plan.stops[0];
  let field: DriverState[] = [{ ...base, id: 'ai-0', name: 'CONTROL', skill: 1.127,
    progress: start.progress, lap: start.lap, speed: start.speed, laneOffset: 0,
    tire: { ...createTire(options.plan.start), wear: start.wear ?? 0 },
    usedCompounds: new Set<Compound>([options.plan.start]),
    pitPlan: options.plan.stops.map(stop => ({ ...stop })),
    plannedPitLap: first?.plannedLap ?? 999, pitLap: first?.plannedLap ?? 999,
    nextCompound: first?.compound ?? options.plan.start, pitStopIndex: 0,
  }, ...(options.rivals ?? [])];
  const remote = sampleTrack(0.25, 260);
  const physics = new RapierRacePhysics(createVehicle(remote.x, remote.y, remote.heading), field);
  field.forEach((driver, index) => {
    const pose = sampleTrack(driver.progress, driver.laneOffset);
    physics.setAiState(index, { ...createVehicle(pose.x, pose.y, pose.heading), speed: driver.speed });
  });
  let elapsed = 0;
  let samples = 0;
  let cuts = 0;
  let followingSeconds = 0;
  let wasPitting = false;
  let lastLap = start.lap;
  let lastLapTime = 0;
  const laps: Array<{ lap: number; seconds: number; wear: number; compound: Compound }> = [];
  const stops: Array<{ entryLap: number; entryProgress: number; entrySeconds: number;
    exitSeconds?: number; oldCompound: Compound; newCompound: Compound; wearBefore: number }> = [];
  try {
    for (let tick = 0; tick < (options.maxSeconds ?? 40 * 60) / dt && !field[0].finished; tick++) {
      field = stepAiField(field, dt, options.totalLaps, [], false);
      if (options.fixedStops) {
        const stop = options.plan.stops[field[0].pitStopIndex];
        // Keep live wear/pace and real driving; replace only the strategy decision.
        field[0].pitLap = stop?.plannedLap ?? 999;
      }
      physics.syncAiKinematics(field, dt, -10);
      physics.step(dt);
      elapsed += dt;
      const driver = field[0];
      const pitting = physics.isAiPitting(0);
      if (pitting && !wasPitting) stops.push({ entryLap: driver.lap,
        entryProgress: driver.progress, entrySeconds: elapsed,
        oldCompound: driver.tire.compound, newCompound: driver.nextCompound,
        wearBefore: driver.tire.wear });
      if (!pitting && wasPitting) stops[stops.length - 1].exitSeconds = elapsed;
      wasPitting = pitting;
      if (driver.battleState === 'FOLLOW' && !pitting) followingSeconds += dt;
      if (driver.lap > lastLap) {
        laps.push({ lap: lastLap, seconds: elapsed - lastLapTime,
          wear: driver.tire.wear, compound: driver.tire.compound });
        lastLap = driver.lap;
        lastLapTime = elapsed;
      }
      if (tick % 10 === 0 && !pitting) {
        const state = physics.aiStates()[0];
        const projection = projectTrackNear(state.x, state.y, driver.progress);
        samples++;
        if (projection.distance > DEEP_CUT_DISTANCE) cuts++;
      }
    }
    return { name: options.plan.name, elapsed, finished: field[0].finished,
      pitStops: field[0].pitStopIndex, usedCompounds: [...field[0].usedCompounds],
      finishWear: field[0].tire.wear, deepCutRatio: cuts / Math.max(1, samples),
      followingSeconds, stops, laps, driver: field[0] };
  } finally {
    physics.world.free();
    setActiveTrack(originalTrack);
  }
}
