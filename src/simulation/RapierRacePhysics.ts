import RAPIER from '@dimforge/rapier2d-compat';
import { aerodynamicEffect } from './AeroModel';
import { controlArcadeCar, type ArcadeCarInput } from './ArcadeCarController';
import { dynamicAiControl } from './DynamicAiController';
import {
  PIT_SPEED,
  beginPitStop,
  createPitStopState,
  isPitActive,
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

export interface PlanarVelocity {
  vx: number;
  vy: number;
}

export class RapierRacePhysics {
  readonly world: RAPIER.World;
  private readonly playerBody: RAPIER.RigidBody;
  private readonly aiBodies: RAPIER.RigidBody[];
  private readonly aiLaps: number[];
  private readonly lastAiProgress: number[];
  private readonly aiPitStops: PitStopState[];
  private playerSlideState = createTyreSlideState(0.37);
  private playerSlideSeverityValue = 0;
  private aiSlideStates: TyreSlideState[];
  private latestAi: DriverState[] = [];
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
    this.aiBodies = ai.map((driver) => {
      const pose = sampleTrack(driver.progress, driver.laneOffset);
      return this.createDynamicCar(pose.x, pose.y, pose.heading, 'AI');
    });
    this.aiLaps = ai.map((driver) => driver.lap);
    this.lastAiProgress = ai.map((driver) => driver.progress);
    this.aiPitStops = ai.map(() => createPitStopState());
    this.aiSlideStates = ai.map((_, index) => createTyreSlideState(index + 1.13));
  }

  drivePlayer(input: PhysicalCarInput, dt: number): void {
    const step = this.driveBody(this.playerBody, input, dt, 1, this.playerSlideState);
    this.playerSlideState = step.state;
    this.playerSlideSeverityValue = step.severity;
  }

  playerSlideSeverity(): number {
    return this.playerSlideSeverityValue;
  }

  /** Raw world-space linear velocity for controllers that need sideslip state. */
  playerVelocity(): PlanarVelocity {
    const velocity = this.playerBody.linvel();
    return { vx: velocity.x, vy: velocity.y };
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
      driver.battleState = control.battleState;
      const projection = projectTrackNear(state.x, state.y, driver.progress);
      const surface = surfaceEffect(projection.distance);
      const aero = aerodynamicEffect(
        {
          id: driver.id,
          lap: this.aiLaps[index] ?? driver.lap,
          progress: projection.progress,
          laneOffset: projection.laneOffset,
        },
        traffic,
      );

      // AI and player have the same physical chassis baseline. Skill changes
      // only how accurately the controller executes the reference lap.
      this.driveAi(index, {
        throttle: control.throttle,
        brake: control.brake,
        steer: control.steer,
        tireGrip: driver.tire.grip * (1 - aero.dirtyAir * 0.42),
        tireWear: driver.tire.wear,
        surfaceGrip: surface.gripMultiplier,
        powerBoost: CORE_POWER_BASELINE + aero.tow * 0.22,
        powerMultiplier: surface.powerMultiplier,
        rollingResistance: surface.rollingResistance,
      }, dt);
    });
  }

  driveAi(index: number, input: PhysicalCarInput, dt: number): void {
    const body = this.aiBodies[index];
    if (!body) return;
    const state = this.aiSlideStates[index] ?? createTyreSlideState(index + 1.13);
    const step = this.driveBody(body, input, dt, 1, state);
    this.aiSlideStates[index] = step.state;
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();

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

  isAiPitting(index: number): boolean {
    return isPitActive(this.aiPitStops[index] ?? createPitStopState());
  }

  setPlayerState(state: VehicleState): void {
    this.setBodyState(this.playerBody, state);
    this.playerSlideState = createTyreSlideState(0.37);
    this.playerSlideSeverityValue = 0;
  }

  setAiState(index: number, state: VehicleState): void {
    const body = this.aiBodies[index];
    if (!body) return;
    this.setBodyState(body, state);
    this.aiSlideStates[index] = createTyreSlideState(index + 1.13);
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
    this.aiSlideStates = ai.map((_, index) => createTyreSlideState(index + 1.13));
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
      driver.strategyIntent = 'DONE';
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
        isPlayer: false,
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
        && !driver.usedCompounds.has(driver.nextCompound);
      if (!isPitActive(this.aiPitStops[index])
        && shouldEnterPit(previous, projection.progress, projection.distance, wantsPit)) {
        this.aiPitStops[index] = beginPitStop();
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
  ): { state: TyreSlideState; severity: number } {
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
    return { state: slide.state, severity: slide.severity };
  }

  private createSafetyBarriers(): void {
    for (const segment of safetyBarrierSegments()) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(segment.x, segment.y)
          .setRotation(segment.heading),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(segment.length * 0.495, TRACK_BARRIER_HALF_THICKNESS)
          // Wall contact should scrub speed but let the car slide along it. A
          // high-friction corner at a hairpin is what made a harmless brush feel
          // like hitting a hidden stake.
          .setFriction(0.025)
          .setRestitution(0.01)
          .setCollisionGroups(BARRIER_COLLISION_GROUPS),
        body,
      );
    }
  }

  private createDynamicCar(x: number, y: number, heading: number, role: CarRole): RAPIER.RigidBody {
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
    this.world.createCollider(collider, body);
    return body;
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

  private setBodyState(body: RAPIER.RigidBody, state: VehicleState): void {
    body.setTranslation({ x: state.x, y: state.y }, true);
    body.setRotation(state.heading, true);
    body.setLinvel({
      x: Math.cos(state.heading) * state.speed,
      y: Math.sin(state.heading) * state.speed,
    }, true);
    body.setAngvel(state.yawRate, true);
  }

  private stopBody(body: RAPIER.RigidBody): void {
    body.setLinvel({ x: 0, y: 0 }, true);
    body.setAngvel(0, true);
  }

  private limitSpin(body: RAPIER.RigidBody, maxYawRate: number): void {
    const yawRate = body.angvel();
    if (Math.abs(yawRate) <= maxYawRate) return;
    body.setAngvel(Math.sign(yawRate) * maxYawRate, true);
  }
}
