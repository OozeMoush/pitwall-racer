import RAPIER from '@dimforge/rapier2d-compat';
import { aerodynamicEffect, towPowerBoost } from './AeroModel';
import { controlArcadeCar, type ArcadeCarInput } from './ArcadeCarController';
import {
  aiEffectiveGrip,
  aiPowerBoostForSkill,
  dynamicAiControl,
  type DynamicAiControl,
} from './DynamicAiController';
import {
  PIT_SPEED,
  beginPitStop,
  createPitStopState,
  isPitActive,
  pitBoxTForSlot,
  pitLanePose,
  shouldEnterPit,
  stepPitStop,
  type PitStopState,
} from './PitLaneModel';
import type { DriverState, RaceTrafficCar } from './RaceModel';
import { surfaceEffect } from './SurfaceModel';
import { createTire } from './TireModel';
import { safetyBarrierSegments } from './TrackBarrierModel';
import { TRACK_BARRIER_HALF_THICKNESS } from './TrackLimitsModel';
import { createTyreSlideState, stepTyreSlide, type TyreSlideState } from './TyrePerformanceModel';
import { projectTrack, projectTrackNear, sampleTrack } from './TrackModel';
import type { VehicleState } from './VehicleModel';

// Match the collision footprint to the rendered car. The old 8.5 x 4.1 half-
// extents were roughly twice the visible body after the 3D/world scaling pass,
// which made wheel-to-wheel racing register contact through empty space.
export const CAR_COLLIDER_HALF_LENGTH = 4.65;
export const CAR_COLLIDER_HALF_WIDTH = 2.15;
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
  private readonly aiColliderHandles = new Set<number>();
  private readonly aiColliderIndexByHandle = new Map<number, number>();
  private readonly barrierColliderHeadings = new Map<number, number>();
  private playerContactKindValue: 'NONE' | 'CAR' | 'BARRIER' = 'NONE';
  private playerImpactSpeedValue = 0;
  private readonly aiBodies: RAPIER.RigidBody[];
  private readonly aiLaps: number[];
  private readonly lastAiProgress: number[];
  private readonly aiPitStops: PitStopState[];
  private playerSlideState = createTyreSlideState(0.37);
  private playerSlideSeverityValue = 0;
  private playerLongitudinalAccelerationValue = 0;
  private aiSlideStates: TyreSlideState[];
  private aiLongitudinalAccelerationValues: number[];
  private aiNetSpeedAccelerationValues: number[];
  private aiPreDriveSpeeds: Array<number | undefined>;
  private latestAi: DriverState[] = [];
  private latestAiControls: Array<DynamicAiControl | undefined> = [];
  private playerLap = 0;

  constructor(playerStart: VehicleState, ai: readonly DriverState[]) {
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
    this.aiPitStops = ai.map(() => createPitStopState());
    this.aiSlideStates = ai.map((_, index) => createTyreSlideState(index + 1.13));
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

  playerContactKind(): 'NONE' | 'CAR' | 'BARRIER' {
    return this.playerContactKindValue;
  }

  playerImpactSpeed(): number {
    return this.playerImpactSpeedValue;
  }

  syncAiKinematics(ai: DriverState[], dt = 1 / 120, playerLap = 0): void {
    this.latestAi = ai;
    this.playerLap = playerLap;
    const states = this.aiStates();
    const traffic = this.actualTraffic(ai, states);

    ai.forEach((driver, index) => {
      const state = states[index];
      if (!state || driver.finished) {
        if (driver.finished) this.stopBody(this.aiBodies[index]);
        return;
      }

      if (isPitActive(this.aiPitStops[index])) {
        this.stepAiPit(index, driver, dt);
        return;
      }

      const control = dynamicAiControl(driver, state, traffic);
      this.latestAiControls[index] = control;
      driver.battleState = control.battleState;
      const projection = projectTrackNear(state.x, state.y, driver.progress);
      const physicalSurfaceProjection = projectTrack(state.x, state.y);
      const surface = surfaceEffect(physicalSurfaceProjection.distance);
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
        throttle: control.throttle,
        brake: control.brake,
        steer: control.steer,
        tireGrip: aiEffectiveGrip(driver)
          * (1 - aero.dirtyAir * 0.42),
        tireWear: driver.tire.wear,
        surfaceGrip: surface.gripMultiplier,
        powerBoost: CORE_POWER_BASELINE
          + aiPowerBoostForSkill(driver.skill)
          + towPowerBoost(aero.tow),
        powerMultiplier: surface.powerMultiplier,
        rollingResistance: surface.rollingResistance,
      }, dt);
    });
  }

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
  }

  setAiState(index: number, state: VehicleState, velocityHeading?: number): void {
    const body = this.aiBodies[index];
    if (!body) return;
    this.setBodyState(body, state, velocityHeading);
    this.aiSlideStates[index] = createTyreSlideState(index + 1.13);
    this.aiLongitudinalAccelerationValues[index] = 0;
    this.aiNetSpeedAccelerationValues[index] = 0;
    this.aiPreDriveSpeeds[index] = undefined;
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
    this.aiSlideStates = ai.map((_, index) => createTyreSlideState(index + 1.13));
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
    });
  }

  private stepAiPit(index: number, driver: DriverState, dt: number): void {
    const previous = this.aiPitStops[index];
    const next = stepPitStop(previous, dt);
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
      } else {
        driver.strategyIntent = 'DONE';
      }
    }

    const pose = pitLanePose(next.t);
    const speed = next.phase === 'SERVICE' ? 0 : PIT_SPEED;
    const pitVehicle: VehicleState = {
      x: pose.x,
      y: pose.y,
      heading: pose.heading,
      speed,
      yawRate: 0,
    };
    this.setAiState(index, pitVehicle);
    driver.progress = pose.raceProgress;
    driver.laneOffset = pose.laneOffset;
    driver.speed = speed;
    driver.battleState = 'CLEAR';

    if (next.phase === 'DONE') {
      const exit = pitLanePose(1);
      const exitVehicle: VehicleState = {
        x: exit.x,
        y: exit.y,
        heading: exit.heading,
        speed: PIT_SPEED,
        yawRate: 0,
      };
      this.setAiState(index, exitVehicle);
      driver.progress = exit.raceProgress;
      driver.laneOffset = exit.laneOffset;
      driver.speed = PIT_SPEED;
      this.lastAiProgress[index] = exit.raceProgress;
      this.aiPitStops[index] = createPitStopState();
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
        && shouldEnterPit(previous, projection.progress, projection.distance, wantsPit)) {
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
      this.aiColliderHandles.add(createdCollider.handle);
      if (aiIndex !== undefined) {
        this.aiColliderIndexByHandle.set(createdCollider.handle, aiIndex);
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
    const playerCollider = this.playerCollider;
    if (!playerCollider) return;

    this.world.contactPairsWith(playerCollider, (otherCollider) => {
      const aiIndex = this.aiColliderIndexByHandle.get(otherCollider.handle);
      if (aiIndex !== undefined) {
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
