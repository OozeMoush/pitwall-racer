import { dynamicAiControl, type DynamicAiControl } from './DynamicAiController';
import { createAiField, type DriverState } from './RaceModel';
import { RapierRacePhysics } from './RapierRacePhysics';
import { activeReferenceTarget } from './RacingLineRuntime';
import { surfaceEffect } from './SurfaceModel';
import { createTire } from './TireModel';
import { getActiveTrack, projectTrackNear, sampleTrack, type TrackId } from './TrackModel';
import { createVehicle, type VehicleState } from './VehicleModel';

const CORE_POWER_BOOST = 0.22;

/**
 * Debug-only isolated replay of the currently active racing line.
 *
 * This is deliberately not a kinematic "perfect ghost": it uses the same
 * DynamicAiController, shared arcade-car physics and circuit barriers as race
 * CPUs, but receives no traffic and runs at 100% reference execution. If this
 * ghost cannot reproduce a PLAYER line, the problem is line/controller
 * execution rather than racecraft.
 */
export class AiReferenceGhost {
  readonly driver: DriverState;
  readonly physics: RapierRacePhysics;
  private lastProgress: number;
  private timedLapStarted = false;
  private lapElapsed = 0;
  private completedLap?: number;
  private control?: DynamicAiControl;

  constructor(startProgress: number, trackId: TrackId = getActiveTrack().id) {
    const base = createAiField()[0];
    const tire = createTire('SOFT');
    const reference = activeReferenceTarget(trackId, startProgress, tire.grip);
    const pose = sampleTrack(startProgress, reference.laneOffset);

    this.driver = {
      ...base,
      id: 'debug-reference-ghost',
      name: 'REFERENCE GHOST',
      progress: startProgress,
      lap: 1,
      speed: reference.targetSpeed,
      tire,
      usedCompounds: new Set(['SOFT']),
      plannedPitLap: 999,
      pitLap: 999,
      nextCompound: 'SOFT',
      laneOffset: reference.laneOffset,
      preferredLane: reference.laneOffset,
      battleState: 'CLEAR',
      skill: 1.14,
      finished: false,
    };

    const dummyPlayer = createVehicle(-10000, -10000, 0);
    this.physics = new RapierRacePhysics(dummyPlayer, [this.driver]);
    this.physics.setAiState(0, {
      ...createVehicle(pose.x, pose.y, pose.heading),
      speed: reference.targetSpeed,
    });
    this.lastProgress = startProgress;
  }

  step(dt: number): void {
    const state = this.physics.aiStates()[0];
    if (!state) return;

    this.control = dynamicAiControl(this.driver, state, []);
    this.driver.battleState = this.control.battleState;
    const projection = projectTrackNear(state.x, state.y, this.driver.progress);
    const surface = surfaceEffect(projection.distance);

    this.physics.driveAi(0, {
      throttle: this.control.throttle,
      brake: this.control.brake,
      steer: this.control.steer,
      tireGrip: this.driver.tire.grip,
      tireWear: 0,
      surfaceGrip: surface.gripMultiplier,
      powerBoost: CORE_POWER_BOOST,
      powerMultiplier: surface.powerMultiplier,
      rollingResistance: surface.rollingResistance,
    }, dt);
    this.physics.step(dt);

    const next = this.physics.aiStates()[0];
    if (!next) return;
    const nextProjection = projectTrackNear(next.x, next.y, this.driver.progress);
    const wrapped = this.lastProgress > 0.88 && nextProjection.progress < 0.12;

    if (this.timedLapStarted) this.lapElapsed += dt;
    if (wrapped) {
      if (this.timedLapStarted && this.lapElapsed > 5) this.completedLap = this.lapElapsed;
      this.timedLapStarted = true;
      this.lapElapsed = 0;
      this.driver.lap += 1;
    }

    this.lastProgress = nextProjection.progress;
    this.driver.progress = nextProjection.progress;
    this.driver.laneOffset = nextProjection.laneOffset;
    this.driver.speed = next.speed;
  }

  state(): VehicleState | undefined {
    return this.physics.aiStates()[0];
  }

  latestControl(): DynamicAiControl | undefined {
    return this.control;
  }

  lastLapSeconds(): number | undefined {
    return this.completedLap;
  }

  currentLapSeconds(): number | undefined {
    return this.timedLapStarted ? this.lapElapsed : undefined;
  }
}
