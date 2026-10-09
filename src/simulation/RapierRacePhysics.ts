import { RacePassingController } from './experiments/RacePassingController';
import { physicalPitControl } from './PhysicalPitControl';
import RAPIER from '@dimforge/rapier2d-compat';
import { aerodynamicEffect, towDragMultiplier, towPowerBoost } from './AeroModel';
import { controlArcadeCar, type ArcadeCarInput } from './ArcadeCarController';
import {
  createAiStuckRecoveryState,
  stepAiStuckRecovery,
  type AiRecoveryPhase,
  type AiStuckRecoveryState,
} from './AiStuckRecovery';
import {
  aiEffectiveGrip,
  aiPowerBoostForSkill,
  dynamicAiControl,
  type DynamicAiControl,
} from './DynamicAiController';
import {
  beginPitStop,
  createPitStopState,
  isPitActive,
  pitBoxTForSlot,
  pitLanePose,
  pitEntryProgress,
  projectPitLane,
  stepPlayerPitStop,
  shouldEnterPit,
  type PitStopState,
} from './PitLaneModel';
import type { DriverState, RaceTrafficCar } from './RaceModel';
import { surfaceEffect } from './SurfaceModel';
import { createTire } from './TireModel';
import { safetyBarrierSegments } from './TrackBarrierModel';
import { TRACK_BARRIER_HALF_THICKNESS } from './TrackLimitsModel';
import { createTyreSlideState, stepTyreSlide, type TyreSlideState } from './TyrePerformanceModel';
import { projectTrack, projectTrackNear, sampleTrack, TRACK_LENGTH } from './TrackModel';
import type { VehicleState } from './VehicleModel';

// Match the collision footprint to the rendered car. The old 8.5 x 4.1 half-
// extents were roughly twice the visible body after the 3D/world scaling pass,
// which made wheel-to-wheel racing register contact through empty space.
export const CAR_COLLIDER_HALF_LENGTH = 4.65;
export const CAR_COLLIDER_HALF_WIDTH = 2.15;
// Brake along the racing line first; merge sideways only once lateral grip can support it.
const AI_PIT_APPROACH_DISTANCE = 200; // metres
const AI_PIT_LATERAL_APPROACH_SPEED = 65; // m/s

// A tyre/sidepod brushing the wall while the car is travelling almost parallel
// to it must not invalidate a racing-line trace. Normal speed alone is too
// strict at racing speed: at 300 km/h even a ~4° graze exceeds 6 m/s laterally.
// Require both a meaningful lateral hit and a meaningful incidence angle.
// Physical wall collision is unchanged; this only controls trace invalidation.
export const WALL_CONTACT_MIN_NORMAL_SPEED = 8;
export const WALL_CONTACT_MIN_INCIDENCE_SIN = 0.12;
// WALL CONTACT for lap validity requires more than geometric overlap. Rapier
// must have removed a noticeable component of velocity into the wall during
// the physics step; this filters collider tolerance/contact-pair false alarms.
export const WALL_CONTACT_MIN_RESPONSE_NORMAL_SPEED = 1.5;
export const WALL_CONTACT_MIN_NORMAL_SPEED_LOSS = 0.35;
// A contact pair alone is not a crash. Cars running nearly the same velocity
// can overlap collider tolerances or brush side-by-side without meaningful
// impact energy. Require a real relative-speed delta before classifying CAR.
export const CAR_CONTACT_MIN_RELATIVE_SPEED = 3.0;
const CORE_POWER_BASELINE = 0.22;

// Arcade contact policy: the player can still make physical contact with an AI
// car, and every car collides with the real circuit barriers. AI cars avoid one
// another through the racecraft controller instead of Rapier impulses. This
// prevents one small first-lap touch from turning into a seven-car roadblock,
// while preserving the contacts the player can actually feel and exploit.
const COLLISION_PLAYER = 0x0001;
const COLLISION_AI = 0x0002;
const COLLISION_BARRIER = 0x0004;

function collisionGroups(membership: number, filter: number): number {
  return (membership << 16) | filter;
}

const PLAYER_COLLISION_GROUPS = collisionGroups(
  COLLISION_PLAYER,
  COLLISION_AI | COLLISION_BARRIER,
);
const AI_COLLISION_GROUPS = collisionGroups(
  COLLISION_AI,
  COLLISION_PLAYER | COLLISION_BARRIER,
);
const BARRIER_COLLISION_GROUPS = collisionGroups(
  COLLISION_BARRIER,
  COLLISION_PLAYER | COLLISION_AI,
);

type PhysicalCarInput = ArcadeCarInput & { tireWear?: number };
type CarRole = 'PLAYER' | 'AI';

export class RapierRacePhysics {
  readonly world: RAPIER.World;
  private readonly playerBody: RAPIER.RigidBody;
  private playerCollider?: RAPIER.Collider;
  private readonly aiColliderIndexByHandle = new Map<number, number>();
  private readonly aiColliders: Array<RAPIER.Collider | undefined> = [];
  private readonly barrierColliderHeadings = new Map<number, number>();
  private playerContactKindValue: 'NONE' | 'CAR' | 'BARRIER' = 'NONE';
  private playerImpactSpeedValue = 0;
  private playerCarPush = { x: 0, y: 0 };
  private aiContactKindValues: Array<'NONE' | 'CAR' | 'BARRIER'>;
  private aiImpactSpeedValues: number[];
  private readonly aiBodies: RAPIER.RigidBody[];
  private readonly aiLaps: number[];
  private readonly lastAiProgress: number[];
  private readonly aiPitStops: PitStopState[];
  private readonly aiPitSteering: number[] = [];
  private aiRecoveryStates: AiStuckRecoveryState[];
  private playerSlideState = createTyreSlideState(0.37);
  private playerSlideSeverityValue = 0;
  private playerLongitudinalAccelerationValue = 0;
  private aiSlideStates: TyreSlideState[];
  private aiSlideSeverityValues: number[];
  private aiLongitudinalAccelerationValues: number[];
  private aiNetSpeedAccelerationValues: number[];
  private aiPreDriveSpeeds: Array<number | undefined>;
  private latestAi: DriverState[] = [];
  private latestAiControls: Array<DynamicAiControl | undefined> = [];
  private playerLap = 0;
  private readonly passingControllers: RacePassingController[] = [];

  constructor(playerStart: VehicleState, ai: readonly DriverState[], private readonly experimentalPassing = false) {
    this.world = new RAPIER.World({ x: 0, y: 0 });
    this.world.timestep = 1 / 120;
    this.world.integrationParameters.maxCcdSubsteps = 4;

    this.createSafetyBarriers();

    this.playerBody = this.createDynamicCar(
      playerStart.x,
      playerStart.y,
      playerStart.heading,
      'PLAYER',
    );
    this.aiBodies = ai.map((driver, index) => {
      const pose = sampleTrack(driver.progress, driver.laneOffset);
      return this.createDynamicCar(pose.x, pose.y, pose.heading, 'AI', index);
    });
    this.aiLaps = ai.map((driver) => driver.lap);
    this.lastAiProgress = ai.map((driver) => driver.progress);
    this.aiContactKindValues = ai.map(() => 'NONE');
    this.aiImpactSpeedValues = ai.map(() => 0);
    this.aiPitStops = ai.map(() => createPitStopState());
    this.aiRecoveryStates = ai.map(() => createAiStuckRecoveryState());
    this.aiSlideStates = ai.map((_, index) => createTyreSlideState(index + 1.13));
    this.aiSlideSeverityValues = ai.map(() => 0);
    this.aiLongitudinalAccelerationValues = ai.map(() => 0);
    this.aiNetSpeedAccelerationValues = ai.map(() => 0);
    this.aiPreDriveSpeeds = ai.map(() => undefined);
  }

  drivePlayer(input: PhysicalCarInput, dt: number): void {
    const step = this.driveBody(this.playerBody, input, dt, 1, this.playerSlideState);
    this.playerSlideState = step.state;
    this.playerSlideSeverityValue = step.severity;
    this.playerLongitudinalAccelerationValue = step.longitudinalAcceleration;
  }

  playerSlideSeverity(): number {
    return this.playerSlideSeverityValue;
  }

  playerLongitudinalAcceleration(): number {
    return this.playerLongitudinalAccelerationValue;
  }

  /** Geometric wall contact remains true at rest; impact classification is
   * deliberately speed-gated and cannot be used to detect a stranded car. */
  playerTouchesBarrier(): boolean {
    const collider = this.playerCollider;
    if (!collider) return false;
    let touching = false;
    this.world.contactPairsWith(collider, other => {
      if (!other.parent()?.isFixed()) return;
      this.world.contactPair(collider, other, manifold => {
        if (manifold.numContacts() > 0) touching = true;
      });
    });
    return touching;
  }

  playerContactKind(): 'NONE' | 'CAR' | 'BARRIER' {
    return this.playerContactKindValue;
  }

  /** Actual car-only normal impulse / player mass from the latest solver step. */
  playerCarPushVelocity(): { x: number; y: number } {
    return this.playerCarPush;
  }

  playerImpactSpeed(): number {
    return this.playerImpactSpeedValue;
  }

  aiContactKind(index: number): 'NONE' | 'CAR' | 'BARRIER' {
    return this.aiContactKindValues[index] ?? 'NONE';
  }

  aiImpactSpeed(index: number): number {
    return this.aiImpactSpeedValues[index] ?? 0;
  }

  syncAiKinematics(ai: DriverState[], dt = 1 / 120, playerLap = 0, playerOnTrack = true): void {
    this.latestAi = ai;
    this.playerLap = playerLap;
    const states = this.aiStates();
    const traffic = this.actualTraffic(ai, states).filter(other =>
      !this.experimentalPassing || (other.isPlayer ? playerOnTrack
        : !isPitActive(this.aiPitStops[ai.findIndex(driver => driver.id === other.id)])));
    const passingFor = (index: number) => this.passingControllers[index] ??= new RacePassingController();

    ai.forEach((driver, index) => {
      const state = states[index];
      if (!state || driver.finished) {
        this.passingControllers[index]?.reset();
        if (driver.finished) this.stopBody(this.aiBodies[index]);
        return;
      }

      if (isPitActive(this.aiPitStops[index])) {
        this.passingControllers[index]?.reset();
        this.stepAiPit(index, driver, dt);
        return;
      }

      const wantsPit = (this.aiLaps[index] ?? driver.lap) >= driver.pitLap
        && driver.pitStopIndex < driver.pitPlan.length;
      const entryGap = wantsPit
        ? ((pitEntryProgress() - projectTrackNear(state.x, state.y, driver.progress).progress + 1) % 1) * TRACK_LENGTH
        : Number.POSITIVE_INFINITY;
      if (entryGap > 0 && entryGap < AI_PIT_APPROACH_DISTANCE) {
        this.passingControllers[index]?.reset();
        const approach = physicalPitControl(state, beginPitStop(pitBoxTForSlot(index + 1)),
          this.aiPitSteering[index] ?? 0, dt, 0, 1, 0, true);
        const road = projectTrackNear(state.x, state.y, driver.progress);
        if (this.reverseAiPitIfStalled(index, state, sampleTrack(road.progress).heading, approach.targetSpeed, dt)) {
          driver.battleState = 'CLEAR';
          return;
        }
        if (state.speed > AI_PIT_LATERAL_APPROACH_SPEED) approach.steer = dynamicAiControl(driver, state, traffic).steer;
        this.aiPitSteering[index] = approach.steer;
        this.driveAi(index, { throttle: approach.throttle, brake: approach.brake,
          steer: approach.steer, tireGrip: driver.tire.grip, tireWear: driver.tire.wear,
          surfaceGrip: 1, powerBoost: CORE_POWER_BASELINE, powerMultiplier: 1,
          rollingResistance: 0 }, dt);
        return;
      }
      const baseControl = dynamicAiControl(driver, state, traffic);
      let control = this.experimentalPassing
        ? passingFor(index).control(driver, state, traffic, baseControl, dt) : baseControl;
      const projection = projectTrackNear(state.x, state.y, driver.progress);
      const recovery = stepAiStuckRecovery(
        this.aiRecoveryStates[index] ?? createAiStuckRecoveryState(),
        {
          speed: state.speed,
          targetSpeed: control.targetSpeed,
        },
        dt,
      );
      this.aiRecoveryStates[index] = recovery;

      if (recovery.phase === 'REVERSE') {
        this.passingControllers[index]?.reset();
        driver.battleState = 'CLEAR';
        this.latestAiControls[index] = {
          ...control,
          throttle: 0,
          brake: 0,
          battleState: 'CLEAR',
        };
        this.applyAiReverse(index, projection.progress, dt);
        return;
      }

      if (recovery.phase === 'RECOVER') {
        this.passingControllers[index]?.reset(); control = baseControl;
      }
      const effectiveControl = recovery.phase === 'RECOVER'
        ? {
            ...control,
            throttle: Math.max(control.throttle, 0.72),
            brake: state.speed < 12 ? 0 : control.brake,
            battleState: 'CLEAR' as const,
          }
        : control;

      this.latestAiControls[index] = effectiveControl;
      driver.battleState = effectiveControl.battleState;
      const physicalSurfaceProjection = projectTrack(state.x, state.y);
      const surface = surfaceEffect(physicalSurfaceProjection.distance, physicalSurfaceProjection.progress);
      const aero = aerodynamicEffect(
        {
          id: driver.id,
          lap: this.aiLaps[index] ?? driver.lap,
          progress: projection.progress,
          laneOffset: projection.laneOffset,
        },
        traffic,
      );

      // Race CPUs deliberately carry a fixed constructor advantage over the
      // player's car. Stronger drivers also get stronger hardware; this is
      // stable performance, never rubber-banding to the player's position.
      this.driveAi(index, {
        throttle: effectiveControl.throttle,
        brake: effectiveControl.brake,
        steer: effectiveControl.steer,
        tireGrip: aiEffectiveGrip(driver)
          * (1 - aero.dirtyAir * 0.42),
        tireWear: driver.tire.wear,
        surfaceGrip: surface.gripMultiplier,
        powerBoost: CORE_POWER_BASELINE
          + aiPowerBoostForSkill(driver.skill)
          + towPowerBoost(aero.tow),
        powerMultiplier: surface.powerMultiplier,
        aeroDragMultiplier: towDragMultiplier(aero.tow),
        rollingResistance: surface.rollingResistance,
      }, dt);
    });
  }

  passingStates() { return this.passingControllers.map(controller => controller.snapshot()); }

  driveAi(index: number, input: PhysicalCarInput, dt: number): void {
    const body = this.aiBodies[index];
    if (!body) return;
    const velocityBeforeDrive = body.linvel();
    this.aiPreDriveSpeeds[index] = Math.hypot(
      velocityBeforeDrive.x,
      velocityBeforeDrive.y,
    );
    const state = this.aiSlideStates[index] ?? createTyreSlideState(index + 1.13);
    const step = this.driveBody(body, input, dt, 1, state);
    this.aiSlideStates[index] = step.state;
    this.aiSlideSeverityValues[index] = step.severity;
    this.aiLongitudinalAccelerationValues[index] = step.longitudinalAcceleration;
  }

  aiLongitudinalAcceleration(index: number): number | undefined {
    return this.aiLongitudinalAccelerationValues[index];
  }

  aiNetSpeedAcceleration(index: number): number | undefined {
    return this.aiNetSpeedAccelerationValues[index];
  }

  playerVelocityHeading(): number | undefined {
    return this.velocityHeading(this.playerBody);
  }

  aiVelocityHeading(index: number): number | undefined {
    const body = this.aiBodies[index];
    return body ? this.velocityHeading(body) : undefined;
  }

  step(dt: number): void {
    this.world.timestep = dt;
    const playerVelocityBeforeStep = this.playerBody.linvel();
    const aiVelocitiesBeforeStep = this.aiBodies.map((body) => {
      const velocity = body.linvel();
      return { x: velocity.x, y: velocity.y };
    });
    this.world.step();
    this.aiBodies.forEach((body, index) => {
      const before = this.aiPreDriveSpeeds[index];
      if (before === undefined || dt <= 0) return;
      const velocity = body.linvel();
      this.aiNetSpeedAccelerationValues[index] = (
        Math.hypot(velocity.x, velocity.y) - before
      ) / dt;
      this.aiPreDriveSpeeds[index] = undefined;
    });
    this.updatePlayerContactKind(
      playerVelocityBeforeStep.x,
      playerVelocityBeforeStep.y,
      aiVelocitiesBeforeStep,
    );
    this.updateAiContactKinds(
      playerVelocityBeforeStep.x,
      playerVelocityBeforeStep.y,
      aiVelocitiesBeforeStep,
    );

    this.limitSpin(this.playerBody, 1.45);
    for (const body of this.aiBodies) this.limitSpin(body, 1.45);
    this.syncAiMetadataFromBodies();
  }

  playerState(): VehicleState {
    return this.bodyState(this.playerBody);
  }

  aiStates(): VehicleState[] {
    return this.aiBodies.map((body) => this.bodyState(body));
  }

  aiControls(): ReadonlyArray<DynamicAiControl | undefined> {
    return this.latestAiControls;
  }

  /** Debug/telemetry view of the same wear-driven slide signal used by AI physics. */
  aiSlideSeverity(index: number): number {
    return this.aiSlideSeverityValues[index] ?? 0;
  }

  aiRecoveryPhase(index: number): AiRecoveryPhase {
    return this.aiRecoveryStates[index]?.phase ?? 'NORMAL';
  }

  /** Actual physical state only; never exposes the driver's future pit plan. */
  aiPitPhase(index: number): 'NONE' | 'TRANSIT_IN' | 'SERVICE' | 'TRANSIT_OUT' {
    const phase = this.aiPitStops[index]?.phase;
    return phase === 'TRANSIT_IN' || phase === 'SERVICE' || phase === 'TRANSIT_OUT' ? phase : 'NONE';
  }

  isAiPitting(index: number): boolean {
    return isPitActive(this.aiPitStops[index] ?? createPitStopState());
  }

  setPlayerState(state: VehicleState): void {
    this.setBodyState(this.playerBody, state);
    this.playerSlideState = createTyreSlideState(0.37);
    this.playerSlideSeverityValue = 0;
    this.playerLongitudinalAccelerationValue = 0;
    this.playerContactKindValue = 'NONE';
    this.playerImpactSpeedValue = 0;
    this.playerCarPush = { x: 0, y: 0 };
  }

  setAiState(index: number, state: VehicleState, velocityHeading?: number): void {
    const body = this.aiBodies[index];
    if (!body) return;
    this.setBodyState(body, state, velocityHeading);
    this.aiSlideStates[index] = createTyreSlideState(index + 1.13);
    this.aiSlideSeverityValues[index] = 0;
    this.aiLongitudinalAccelerationValues[index] = 0;
    this.aiNetSpeedAccelerationValues[index] = 0;
    this.aiPreDriveSpeeds[index] = undefined;
    this.aiContactKindValues[index] = 'NONE';
    this.aiImpactSpeedValues[index] = 0;
  }

  stopPlayer(): void {
    this.stopBody(this.playerBody);
    this.playerSlideSeverityValue = 0;
  }

  stopAll(): void {
    this.stopBody(this.playerBody);
    for (const body of this.aiBodies) this.stopBody(body);
    this.playerSlideSeverityValue = 0;
  }

  reset(playerStart: VehicleState, ai: readonly DriverState[]): void {
    this.setPlayerState(playerStart);
    this.playerLap = 0;
    this.latestAiControls = [];
    this.passingControllers.forEach(controller => controller.reset());
    this.aiRecoveryStates = ai.map(() => createAiStuckRecoveryState());
    this.aiSlideStates = ai.map((_, index) => createTyreSlideState(index + 1.13));
    this.aiSlideSeverityValues = ai.map(() => 0);
    this.aiContactKindValues = ai.map(() => 'NONE');
    this.aiImpactSpeedValues = ai.map(() => 0);
    this.aiLongitudinalAccelerationValues = ai.map(() => 0);
    this.aiNetSpeedAccelerationValues = ai.map(() => 0);
    this.aiPreDriveSpeeds = ai.map(() => undefined);
    ai.forEach((driver, index) => {
      const pose = sampleTrack(driver.progress, driver.laneOffset);
      this.setAiState(index, {
        x: pose.x,
        y: pose.y,
        heading: pose.heading,
        speed: 0,
        yawRate: 0,
      });
      this.aiLaps[index] = driver.lap;
      this.lastAiProgress[index] = driver.progress;
      this.aiPitStops[index] = createPitStopState();
      this.aiPitSteering[index] = 0;
    });
  }

  private stepAiPit(index: number, driver: DriverState, dt: number): void {
    const previous = this.aiPitStops[index];
    const vehicle = this.bodyState(this.aiBodies[index]);
    let next = previous;
    if (previous.phase === 'SERVICE') {
      this.aiRecoveryStates[index] = createAiStuckRecoveryState();
      next = stepPlayerPitStop(previous, dt, previous.t);
      const box = pitLanePose(previous.boxT);
      this.setAiState(index, { x: box.x, y: box.y, heading: box.heading, speed: 0, yawRate: 0 });
      this.aiPitSteering[index] = 0;
    } else {
      const observed = projectPitLane(vehicle.x, vehicle.y, previous.t);
      next = stepPlayerPitStop(previous, dt, observed.t);
      if (next.phase === 'SERVICE') {
        this.aiRecoveryStates[index] = createAiStuckRecoveryState();
        // Match the player's one small final docking correction.
        const box = pitLanePose(next.boxT);
        this.setAiState(index, { x: box.x, y: box.y, heading: box.heading, speed: 0, yawRate: 0 });
        this.aiPitSteering[index] = 0;
      } else if (next.phase !== 'DONE') {
        const control = physicalPitControl(vehicle, next, this.aiPitSteering[index] ?? 0, dt);
        this.aiPitSteering[index] = control.steer;
        if (!this.reverseAiPitIfStalled(index, vehicle, observed.pose.heading, control.targetSpeed, dt)) {
          this.driveAi(index, { throttle: control.throttle, brake: control.brake,
            steer: control.steer, tireGrip: driver.tire.grip, tireWear: driver.tire.wear,
            surfaceGrip: 1, powerBoost: CORE_POWER_BASELINE, powerMultiplier: 1,
            rollingResistance: 0 }, dt);
        }
      }
    }
    this.aiPitStops[index] = next;
    if (!previous.tyreChanged && next.tyreChanged) {
      driver.tire = createTire(driver.nextCompound);
      driver.usedCompounds = new Set(driver.usedCompounds);
      driver.usedCompounds.add(driver.nextCompound);
      driver.pitStopIndex += 1;
      const followingStop = driver.pitPlan[driver.pitStopIndex];
      if (followingStop) {
        driver.plannedPitLap = followingStop.plannedLap;
        driver.pitLap = followingStop.plannedLap;
        driver.nextCompound = followingStop.compound;
        driver.strategyIntent = 'PLAN';
      } else driver.strategyIntent = 'DONE';
    }
    driver.battleState = 'CLEAR';
    if (next.phase === 'DONE') {
      // Keep the physical exit pose and velocity; do not teleport to a limiter-speed pose.
      this.aiPitStops[index] = createPitStopState();
      this.aiPitSteering[index] = 0;
      this.aiRecoveryStates[index] = createAiStuckRecoveryState();
    }
  }

  private actualTraffic(ai: readonly DriverState[], states: readonly VehicleState[]): RaceTrafficCar[] {
    const result: RaceTrafficCar[] = [];
    const player = this.playerState();
    const playerProjection = projectTrack(player.x, player.y);
    result.push({
      id: 'player',
      lap: this.playerLap,
      progress: playerProjection.progress,
      speed: player.speed,
      laneOffset: playerProjection.laneOffset,
      performance: 1,
      isPlayer: true,
    });

    ai.forEach((driver, index) => {
      const state = states[index];
      if (!state || driver.finished) return;
      const projection = projectTrackNear(state.x, state.y, driver.progress);
      result.push({
        id: driver.id,
        lap: this.aiLaps[index] ?? driver.lap,
        progress: projection.progress,
        speed: state.speed,
        laneOffset: projection.laneOffset,
        performance: driver.skill * driver.tire.grip,
      });
    });
    return result;
  }

  private syncAiMetadataFromBodies(): void {
    this.latestAi.forEach((driver, index) => {
      const body = this.aiBodies[index];
      if (!body || driver.finished) return;
      const state = this.bodyState(body);
      const previous = this.lastAiProgress[index] ?? driver.progress;
      const projection = projectTrackNear(state.x, state.y, previous);

      if (previous > 0.88 && projection.progress < 0.12) {
        this.aiLaps[index] = (this.aiLaps[index] ?? driver.lap) + 1;
      }

      const currentLap = this.aiLaps[index] ?? driver.lap;
      const wantsPit = currentLap > 0
        && currentLap >= driver.pitLap
        && driver.pitStopIndex < driver.pitPlan.length;
      if (!isPitActive(this.aiPitStops[index])
        && shouldEnterPit(previous, projection.progress, projection.distance, wantsPit, projection.laneOffset)) {
        this.aiPitStops[index] = beginPitStop(pitBoxTForSlot(index + 1));
        driver.battleState = 'CLEAR';
      }

      this.lastAiProgress[index] = projection.progress;
      driver.progress = projection.progress;
      driver.lap = currentLap;
      driver.laneOffset = projection.laneOffset;
      driver.speed = state.speed;
    });
  }

  private reverseAiPitIfStalled(index: number, vehicle: VehicleState,
    referenceHeading: number, targetSpeed: number, dt: number): boolean {
    const recovery = stepAiStuckRecovery(
      this.aiRecoveryStates[index] ?? createAiStuckRecoveryState(),
      { speed: vehicle.speed, targetSpeed, movementRequested: true }, dt,
    );
    this.aiRecoveryStates[index] = recovery;
    if (recovery.phase !== 'REVERSE') return false;
    // Back away through the real body, aligning with this route rather than
    // the main-road tangent. No positional or service-progress correction.
    this.applyAiReverse(index, 0, dt, referenceHeading);
    this.aiPitSteering[index] = 0;
    return true;
  }

  private applyAiReverse(
    index: number,
    progress: number,
    dt: number,
    referenceHeading = sampleTrack(progress, 0).heading,
  ): void {
    const body = this.aiBodies[index];
    if (!body) return;

    const velocity = body.linvel();
    this.aiPreDriveSpeeds[index] = Math.hypot(velocity.x, velocity.y);

    const heading = body.rotation();
    const reverseSpeed = 5.2;
    const response = 1 - Math.exp(-Math.max(0, dt) * 4.6);
    const targetVx = -Math.cos(heading) * reverseSpeed;
    const targetVy = -Math.sin(heading) * reverseSpeed;

    body.setLinvel({
      x: velocity.x + (targetVx - velocity.x) * response,
      y: velocity.y + (targetVy - velocity.y) * response,
    }, true);

    const headingError = wrapAngle(referenceHeading - heading);
    const desiredYaw = clamp(headingError * 1.25, -0.55, 0.55);
    body.setAngvel(
      body.angvel() + (desiredYaw - body.angvel()) * response,
      true,
    );

    this.aiLongitudinalAccelerationValues[index] = -4.5;
  }

  private driveBody(
    body: RAPIER.RigidBody,
    input: PhysicalCarInput,
    dt: number,
    response: number,
    slideState: TyreSlideState,
  ): { state: TyreSlideState; severity: number; longitudinalAcceleration: number } {
    const velocity = body.linvel();
    const speed = Math.hypot(velocity.x, velocity.y);
    const slide = stepTyreSlide(slideState, {
      wear: input.tireWear ?? 0,
      speed,
      steer: input.steer,
      throttle: input.throttle,
    }, dt);
    const controlled = controlArcadeCar(
      {
        vx: velocity.x,
        vy: velocity.y,
        heading: body.rotation(),
        angularVelocity: body.angvel(),
      },
      {
        ...input,
        slideSeverity: slide.severity,
        slideDirection: slide.direction,
      },
      dt,
    );

    body.setLinvel({
      x: velocity.x + (controlled.vx - velocity.x) * response,
      y: velocity.y + (controlled.vy - velocity.y) * response,
    }, true);
    body.setAngvel(body.angvel() + (controlled.angularVelocity - body.angvel()) * response, true);
    return {
      state: slide.state,
      severity: slide.severity,
      longitudinalAcceleration: controlled.acceleration,
    };
  }

  private createSafetyBarriers(): void {
    for (const segment of safetyBarrierSegments()) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(segment.x, segment.y)
          .setRotation(segment.heading),
      );
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(segment.length * 0.495, TRACK_BARRIER_HALF_THICKNESS)
          // Wall contact should scrub speed but let the car slide along it. A
          // high-friction corner at a hairpin is what made a harmless brush feel
          // like hitting a hidden stake.
          .setFriction(0.025)
          .setRestitution(0.01)
          .setCollisionGroups(BARRIER_COLLISION_GROUPS),
        body,
      );
      this.barrierColliderHeadings.set(collider.handle, segment.heading);
    }
  }

  private createDynamicCar(
    x: number,
    y: number,
    heading: number,
    role: CarRole,
    aiIndex?: number,
  ): RAPIER.RigidBody {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setRotation(heading)
      .setLinearDamping(0.018)
      .setAngularDamping(1.05)
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setAdditionalSolverIterations(5);
    const body = this.world.createRigidBody(bodyDesc);
    const collider = RAPIER.ColliderDesc.cuboid(CAR_COLLIDER_HALF_LENGTH, CAR_COLLIDER_HALF_WIDTH)
      .setDensity(0.025)
      .setFriction(0.018)
      .setRestitution(0)
      .setCollisionGroups(role === 'PLAYER' ? PLAYER_COLLISION_GROUPS : AI_COLLISION_GROUPS);
    const createdCollider = this.world.createCollider(collider, body);
    if (role === 'PLAYER') {
      this.playerCollider = createdCollider;
    } else {
      if (aiIndex !== undefined) {
        this.aiColliderIndexByHandle.set(createdCollider.handle, aiIndex);
        this.aiColliders[aiIndex] = createdCollider;
      }
    }
    return body;
  }

  private updatePlayerContactKind(
    preStepVx: number,
    preStepVy: number,
    aiVelocitiesBeforeStep: readonly { x: number; y: number }[],
  ): void {
    this.playerContactKindValue = 'NONE';
    this.playerImpactSpeedValue = 0;
    this.playerCarPush = { x: 0, y: 0 };
    const playerCollider = this.playerCollider;
    if (!playerCollider) return;

    this.world.contactPairsWith(playerCollider, (otherCollider) => {
      const aiIndex = this.aiColliderIndexByHandle.get(otherCollider.handle);
      if (aiIndex !== undefined) {
        this.world.contactPair(playerCollider, otherCollider, (manifold, flipped) => {
          const normal = manifold.normal();
          let impulse = 0;
          for (let i = 0; i < manifold.numContacts(); i++) impulse += manifold.contactImpulse(i);
          const change = impulse / this.playerBody.mass() * (flipped ? 1 : -1);
          this.playerCarPush.x += normal.x * change;
          this.playerCarPush.y += normal.y * change;
        });
        const otherVelocity = aiVelocitiesBeforeStep[aiIndex];
        if (!otherVelocity) return;
        const relativeSpeed = carRelativeImpactSpeed(
          preStepVx,
          preStepVy,
          otherVelocity.x,
          otherVelocity.y,
        );
        if (relativeSpeed < CAR_CONTACT_MIN_RELATIVE_SPEED) return;
        this.playerContactKindValue = 'CAR';
        this.playerImpactSpeedValue = Math.max(
          this.playerImpactSpeedValue,
          relativeSpeed,
        );
        return;
      }

      if (this.playerContactKindValue === 'CAR') return;
      const barrierHeading = this.barrierColliderHeadings.get(otherCollider.handle);
      if (barrierHeading === undefined) return;

      const postStepVelocity = this.playerBody.linvel();
      if (
        isPhysicalBarrierImpact(
          preStepVx,
          preStepVy,
          postStepVelocity.x,
          postStepVelocity.y,
          barrierHeading,
        )
      ) {
        this.playerContactKindValue = 'BARRIER';
        this.playerImpactSpeedValue = Math.max(
          this.playerImpactSpeedValue,
          barrierNormalSpeed(preStepVx, preStepVy, barrierHeading),
        );
      }
    });
  }

  private updateAiContactKinds(
    playerPreStepVx: number,
    playerPreStepVy: number,
    aiVelocitiesBeforeStep: readonly { x: number; y: number }[],
  ): void {
    this.aiContactKindValues.fill('NONE');
    this.aiImpactSpeedValues.fill(0);

    this.aiColliders.forEach((aiCollider, index) => {
      if (!aiCollider) return;
      const before = aiVelocitiesBeforeStep[index];
      const body = this.aiBodies[index];
      if (!before || !body) return;

      this.world.contactPairsWith(aiCollider, (otherCollider) => {
        if (otherCollider.handle === this.playerCollider?.handle) {
          const relativeSpeed = carRelativeImpactSpeed(
            before.x,
            before.y,
            playerPreStepVx,
            playerPreStepVy,
          );
          if (relativeSpeed < CAR_CONTACT_MIN_RELATIVE_SPEED) return;
          this.aiContactKindValues[index] = 'CAR';
          this.aiImpactSpeedValues[index] = Math.max(
            this.aiImpactSpeedValues[index] ?? 0,
            relativeSpeed,
          );
          return;
        }

        if (this.aiContactKindValues[index] === 'CAR') return;
        const barrierHeading = this.barrierColliderHeadings.get(otherCollider.handle);
        if (barrierHeading === undefined) return;

        const postStepVelocity = body.linvel();
        if (
          isPhysicalBarrierImpact(
            before.x,
            before.y,
            postStepVelocity.x,
            postStepVelocity.y,
            barrierHeading,
          )
        ) {
          this.aiContactKindValues[index] = 'BARRIER';
          this.aiImpactSpeedValues[index] = Math.max(
            this.aiImpactSpeedValues[index] ?? 0,
            barrierNormalSpeed(before.x, before.y, barrierHeading),
          );
        }
      });
    });
  }

  private bodyState(body: RAPIER.RigidBody): VehicleState {
    const position = body.translation();
    const velocity = body.linvel();
    return {
      x: position.x,
      y: position.y,
      heading: body.rotation(),
      speed: Math.hypot(velocity.x, velocity.y),
      yawRate: body.angvel(),
    };
  }

  private setBodyState(
    body: RAPIER.RigidBody,
    state: VehicleState,
    velocityHeading = state.heading,
  ): void {
    body.setTranslation({ x: state.x, y: state.y }, true);
    body.setRotation(state.heading, true);
    body.setLinvel({
      x: Math.cos(velocityHeading) * state.speed,
      y: Math.sin(velocityHeading) * state.speed,
    }, true);
    body.setAngvel(state.yawRate, true);
  }

  private velocityHeading(body: RAPIER.RigidBody): number | undefined {
    const velocity = body.linvel();
    if (Math.hypot(velocity.x, velocity.y) < 0.05) return undefined;
    return Math.atan2(velocity.y, velocity.x);
  }

  private stopBody(body: RAPIER.RigidBody | undefined): void {
    if (!body) return;
    body.setLinvel({ x: 0, y: 0 }, true);
    body.setAngvel(0, true);
  }

  private limitSpin(body: RAPIER.RigidBody, maximum: number): void {
    const yaw = body.angvel();
    if (Math.abs(yaw) > maximum) body.setAngvel(Math.sign(yaw) * maximum, true);
  }
}

export function barrierNormalSpeed(
  vx: number,
  vy: number,
  barrierHeading: number,
): number {
  const nx = -Math.sin(barrierHeading);
  const ny = Math.cos(barrierHeading);
  return Math.abs(vx * nx + vy * ny);
}

export function isSignificantBarrierImpact(
  vx: number,
  vy: number,
  barrierHeading: number,
): boolean {
  const speed = Math.hypot(vx, vy);
  if (speed < 0.001) return false;
  const normalSpeed = barrierNormalSpeed(vx, vy, barrierHeading);
  const incidenceSin = normalSpeed / speed;
  return normalSpeed >= WALL_CONTACT_MIN_NORMAL_SPEED
    && incidenceSin >= WALL_CONTACT_MIN_INCIDENCE_SIN;
}


export function isPhysicalBarrierImpact(
  preVx: number,
  preVy: number,
  postVx: number,
  postVy: number,
  barrierHeading: number,
): boolean {
  const beforeNormal = barrierNormalSpeed(preVx, preVy, barrierHeading);
  const afterNormal = barrierNormalSpeed(postVx, postVy, barrierHeading);
  return beforeNormal >= WALL_CONTACT_MIN_RESPONSE_NORMAL_SPEED
    && beforeNormal - afterNormal >= WALL_CONTACT_MIN_NORMAL_SPEED_LOSS;
}


export function carRelativeImpactSpeed(
  playerVx: number,
  playerVy: number,
  otherVx: number,
  otherVy: number,
): number {
  return Math.hypot(playerVx - otherVx, playerVy - otherVy);
}


function wrapAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
