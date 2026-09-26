import { dynamicAiControl, type DynamicAiControl } from './DynamicAiController';
import { createAiField, type DriverState } from './RaceModel';
import { RapierRacePhysics } from './RapierRacePhysics';
import { sampleRacingLineAsset } from './RacingLineAsset';
import {
  activeReferenceTarget,
  runtimeRacingLine,
  sampleRuntimeRacingLinePose,
} from './RacingLineRuntime';
import { surfaceEffect } from './SurfaceModel';
import { createTire } from './TireModel';
import { getActiveTrack, projectTrackNear, sampleTrack, TRACK_LENGTH, type TrackId } from './TrackModel';
import { createVehicle, type VehicleState } from './VehicleModel';

const CORE_POWER_BOOST = 0.22;

export interface AiReferenceGhostLossEvent {
  progress: number;
  netAccelerationDelta: number;
  speedDeficitKph: number;
  pathError: number;
  yawError: number;
}

export interface AiReferenceGhostSpeedDriftEvent {
  progress: number;
  speedDeltaKph: number;
  pathError: number;
  yawError: number;
  sourceForwardAcceleration?: number;
  actualForwardAcceleration?: number;
  feedbackBrake: number;
  profileBrake: number;
  throttle: number;
}

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
  private readonly trackId: TrackId;
  private lastProgress: number;
  private warmupWraps = 0;
  private timedLapStarted = false;
  private lapElapsed = 0;
  private completedLap?: number;
  private control?: DynamicAiControl;
  private currentWorstLoss?: AiReferenceGhostLossEvent;
  private completedWorstLoss?: AiReferenceGhostLossEvent;
  private currentFirstSpeedDrift?: AiReferenceGhostSpeedDriftEvent;
  private completedFirstSpeedDrift?: AiReferenceGhostSpeedDriftEvent;

  constructor(
    startProgress: number,
    trackId: TrackId = getActiveTrack().id,
    timeFromInitialState = false,
  ) {
    this.trackId = trackId;
    const base = createAiField()[0];
    const lineAsset = runtimeRacingLine(trackId);
    const freshSoft = createTire('SOFT');
    // The isolated ghost answers one specific question: can this exact
    // demonstrated asset be replayed under the physical conditions in which
    // it was recorded? Tyre/grip transfer to race compounds is a separate
    // execution problem and must not contaminate this baseline.
    const tire = lineAsset?.referenceGrip !== undefined
      ? { ...freshSoft, grip: lineAsset.referenceGrip }
      : freshSoft;
    const reference = activeReferenceTarget(trackId, startProgress, tire.grip);
    const pose = sampleRuntimeRacingLinePose(trackId, startProgress);
    const demonstrated = lineAsset
      ? sampleRacingLineAsset(lineAsset, startProgress)
      : undefined;
    const lineHeading = pose.demonstratedHeading ?? pose.heading;
    const initialYawRate = demonstrated?.yawRate ?? 0;

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
      ...createVehicle(pose.x, pose.y, lineHeading),
      speed: reference.targetSpeed,
      yawRate: initialYawRate,
    }, pose.trajectoryHeading);
    this.lastProgress = startProgress;
    if (timeFromInitialState) {
      // Diagnostic replay: start from the stored lap state itself, not from a
      // standing start or a controller-generated periodic orbit. This isolates
      // whether the recorded state is sufficient to reproduce one lap.
      this.warmupWraps = 2;
      this.timedLapStarted = true;
      this.lapElapsed = 0;
    }
  }

  step(dt: number): void {
    const state = this.physics.aiStates()[0];
    if (!state) return;

    const lineAsset = runtimeRacingLine(getActiveTrack().id);
    const sourceSample = lineAsset
      ? sampleRacingLineAsset(lineAsset, this.driver.progress)
      : undefined;
    if (sourceSample?.tireGrip !== undefined) {
      this.driver.tire = { ...this.driver.tire, grip: sourceSample.tireGrip };
    }

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

    if (this.timedLapStarted && sourceSample?.longitudinalAcceleration !== undefined) {
      const actualNetAcceleration = this.physics.aiNetSpeedAcceleration(0);
      if (actualNetAcceleration !== undefined) {
        const targetYawRate = this.control.debug.targetYawRate ?? 0;
        const speedDeltaKph = (state.speed - this.control.targetSpeed) * 3.6;
        if (!this.currentFirstSpeedDrift && Math.abs(speedDeltaKph) >= 15) {
          this.currentFirstSpeedDrift = {
            progress: this.driver.progress,
            speedDeltaKph,
            pathError: this.control.debug.pathError,
            yawError: state.yawRate - targetYawRate,
            sourceForwardAcceleration: this.control.debug.sourceForwardAcceleration,
            actualForwardAcceleration: this.physics.aiLongitudinalAcceleration(0),
            feedbackBrake: this.control.debug.feedbackBrake,
            profileBrake: this.control.debug.profileBrake,
            throttle: this.control.throttle,
          };
        }
        const event: AiReferenceGhostLossEvent = {
          progress: this.driver.progress,
          netAccelerationDelta: actualNetAcceleration - sourceSample.longitudinalAcceleration,
          speedDeficitKph: (this.control.targetSpeed - state.speed) * 3.6,
          pathError: this.control.debug.pathError,
          yawError: state.yawRate - targetYawRate,
        };
        if (
          !this.currentWorstLoss
          || event.netAccelerationDelta < this.currentWorstLoss.netAccelerationDelta
        ) {
          this.currentWorstLoss = event;
        }
      }
    }

    const next = this.physics.aiStates()[0];
    if (!next) return;
    const nextProjection = projectTrackNear(next.x, next.y, this.driver.progress);
    const wrapped = this.lastProgress > 0.88 && nextProjection.progress < 0.12;

    if (this.timedLapStarted) this.lapElapsed += dt;
    if (wrapped) {
      if (this.timedLapStarted) {
        if (this.lapElapsed > 5) {
          this.completedLap = this.lapElapsed;
          this.completedWorstLoss = this.currentWorstLoss;
          this.completedFirstSpeedDrift = this.currentFirstSpeedDrift;
        }
        this.lapElapsed = 0;
        this.currentWorstLoss = undefined;
        this.currentFirstSpeedDrift = undefined;
      } else {
        // The ghost is spawned at the currently selected CPU's arbitrary
        // progress. The first crossing therefore ends only a partial warmup.
        // Require one complete additional untimed lap before measuring replay,
        // otherwise the timed lap inherits a large start-line state error.
        this.warmupWraps += 1;
        if (this.warmupWraps >= 2) {
          this.timedLapStarted = true;
          this.lapElapsed = 0;
          this.currentWorstLoss = undefined;
          this.currentFirstSpeedDrift = undefined;
        }
      }
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

  latestForwardAcceleration(): number | undefined {
    return this.physics.aiLongitudinalAcceleration(0);
  }

  latestNetSpeedAcceleration(): number | undefined {
    return this.physics.aiNetSpeedAcceleration(0);
  }

  latestSlipAngle(): number | undefined {
    const state = this.state();
    const velocityHeading = this.physics.aiVelocityHeading(0);
    if (!state || velocityHeading === undefined) return undefined;
    return wrapAngle(velocityHeading - state.heading);
  }

  sourceSlipAngle(): number | undefined {
    const pose = sampleRuntimeRacingLinePose(this.trackId, this.driver.progress);
    if (pose.demonstratedHeading === undefined) return undefined;
    return wrapAngle(pose.trajectoryHeading - pose.demonstratedHeading);
  }

  lastLapSeconds(): number | undefined {
    return this.completedLap;
  }

  currentLapSeconds(): number | undefined {
    return this.timedLapStarted ? this.lapElapsed : undefined;
  }

  warmupLapsRemaining(): number {
    return Math.max(0, 2 - this.warmupWraps);
  }

  lastWorstLoss(): AiReferenceGhostLossEvent | undefined {
    return this.completedWorstLoss;
  }

  lastFirstSpeedDrift(): AiReferenceGhostSpeedDriftEvent | undefined {
    return this.completedFirstSpeedDrift;
  }
}


function wrapAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}
