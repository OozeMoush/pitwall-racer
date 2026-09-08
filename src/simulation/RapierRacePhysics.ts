import RAPIER from '@dimforge/rapier2d-compat';
import { controlArcadeCar, type ArcadeCarInput } from './ArcadeCarController';
import { dynamicAiControl } from './DynamicAiController';
import type { DriverState, RaceTrafficCar } from './RaceModel';
import { projectTrack, sampleTrack, TRACK_LENGTH } from './TrackModel';
import type { VehicleState } from './VehicleModel';

const CAR_HALF_LENGTH = 10;
const CAR_HALF_WIDTH = 4.1;

export class RapierRacePhysics {
  readonly world: RAPIER.World;
  private readonly playerBody: RAPIER.RigidBody;
  private readonly aiBodies: RAPIER.RigidBody[];
  private readonly aiLaps: number[];
  private readonly lastAiProgress: number[];
  private latestAi: DriverState[] = [];

  constructor(playerStart: VehicleState, ai: readonly DriverState[]) {
    this.world = new RAPIER.World({ x: 0, y: 0 });
    this.world.timestep = 1 / 120;
    this.world.integrationParameters.maxCcdSubsteps = 4;

    this.playerBody = this.createDynamicCar(playerStart.x, playerStart.y, playerStart.heading);
    this.aiBodies = ai.map((driver) => {
      const pose = sampleTrack(driver.progress, driver.laneOffset);
      return this.createDynamicCar(pose.x, pose.y, pose.heading);
    });
    this.aiLaps = ai.map((driver) => driver.lap);
    this.lastAiProgress = ai.map((driver) => driver.progress);
  }

  drivePlayer(input: ArcadeCarInput, dt: number): void {
    this.driveBody(this.playerBody, input, dt, 1);
  }

  /**
   * Compatibility entry used by the current race scene. The old implementation
   * teleported kinematic AI to its progress value every tick. The method name is
   * kept while the migration is in progress, but it now drives real dynamic
   * bodies using the same car controller as the player.
   */
  syncAiKinematics(ai: DriverState[], dt = 1 / 120): void {
    this.latestAi = ai;
    const states = this.aiStates();
    const traffic = this.actualTraffic(ai, states);

    ai.forEach((driver, index) => {
      const state = states[index];
      if (!state || driver.finished) {
        if (driver.finished) this.stopBody(this.aiBodies[index]);
        return;
      }
      const control = dynamicAiControl(driver, state, traffic);
      driver.battleState = control.battleState;
      this.driveAi(index, {
        throttle: control.throttle,
        brake: control.brake,
        steer: control.steer,
        tireGrip: driver.tire.grip,
        surfaceGrip: 1,
        powerBoost: control.battleState === 'ATTACK' ? 0.045 : 0,
        powerMultiplier: 1,
        rollingResistance: 0,
      }, dt);
    });
  }

  driveAi(index: number, input: ArcadeCarInput, dt: number): void {
    const body = this.aiBodies[index];
    if (!body) return;
    this.driveBody(body, input, dt, 1);
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();

    this.limitSpin(this.playerBody, 1.45);
    for (const body of this.aiBodies) this.limitSpin(body, 1.35);
    this.syncAiMetadataFromBodies();
  }

  playerState(): VehicleState {
    return this.bodyState(this.playerBody);
  }

  aiStates(): VehicleState[] {
    return this.aiBodies.map((body) => this.bodyState(body));
  }

  setPlayerState(state: VehicleState): void {
    this.setBodyState(this.playerBody, state);
  }

  setAiState(index: number, state: VehicleState): void {
    const body = this.aiBodies[index];
    if (!body) return;
    this.setBodyState(body, state);
  }

  stopPlayer(): void {
    this.stopBody(this.playerBody);
  }

  stopAll(): void {
    this.stopBody(this.playerBody);
    for (const body of this.aiBodies) this.stopBody(body);
  }

  reset(playerStart: VehicleState, ai: readonly DriverState[]): void {
    this.setPlayerState(playerStart);
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
    });
  }

  private actualTraffic(ai: readonly DriverState[], states: readonly VehicleState[]): RaceTrafficCar[] {
    const result: RaceTrafficCar[] = [];
    const player = this.playerState();
    const playerProjection = projectTrack(player.x, player.y);
    result.push({
      id: 'player',
      lap: 1,
      progress: playerProjection.progress,
      speed: player.speed,
      laneOffset: playerProjection.laneOffset,
      performance: 1,
      isPlayer: true,
    });

    ai.forEach((driver, index) => {
      const state = states[index];
      if (!state || driver.finished) return;
      const projection = projectTrack(state.x, state.y);
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
      const projection = projectTrack(state.x, state.y);
      const previous = this.lastAiProgress[index] ?? projection.progress;
      if (previous > 0.88 && projection.progress < 0.12) this.aiLaps[index] = (this.aiLaps[index] ?? driver.lap) + 1;
      this.lastAiProgress[index] = projection.progress;
      driver.progress = projection.progress;
      driver.lap = this.aiLaps[index] ?? driver.lap;
      driver.laneOffset = projection.laneOffset;
      driver.speed = state.speed;
    });
  }

  private driveBody(body: RAPIER.RigidBody, input: ArcadeCarInput, dt: number, response: number): void {
    const velocity = body.linvel();
    const controlled = controlArcadeCar(
      {
        vx: velocity.x,
        vy: velocity.y,
        heading: body.rotation(),
        angularVelocity: body.angvel(),
      },
      input,
      dt,
    );

    body.setLinvel({
      x: velocity.x + (controlled.vx - velocity.x) * response,
      y: velocity.y + (controlled.vy - velocity.y) * response,
    }, true);
    body.setAngvel(body.angvel() + (controlled.angularVelocity - body.angvel()) * response, true);
  }

  private createDynamicCar(x: number, y: number, heading: number): RAPIER.RigidBody {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setRotation(heading)
      .setLinearDamping(0.018)
      .setAngularDamping(1.05)
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setAdditionalSolverIterations(5);
    const body = this.world.createRigidBody(bodyDesc);
    const collider = RAPIER.ColliderDesc.cuboid(CAR_HALF_LENGTH, CAR_HALF_WIDTH)
      .setDensity(0.025)
      .setFriction(0.018)
      .setRestitution(0);
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
