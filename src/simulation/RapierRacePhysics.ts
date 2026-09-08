import RAPIER from '@dimforge/rapier2d-compat';
import { controlArcadeCar, type ArcadeCarInput } from './ArcadeCarController';
import type { DriverState } from './RaceModel';
import { sampleTrack } from './TrackModel';
import type { VehicleState } from './VehicleModel';

// Collider dimensions are expressed in simulation units. They deliberately
// match the visible 3D car after WORLD_SCALE is applied instead of preserving
// the oversized invisible collision boxes from the first Rapier slice.
const CAR_HALF_LENGTH = 10;
const CAR_HALF_WIDTH = 4.1;

export class RapierRacePhysics {
  readonly world: RAPIER.World;
  private readonly playerBody: RAPIER.RigidBody;
  private readonly aiBodies: RAPIER.RigidBody[];

  constructor(playerStart: VehicleState, ai: readonly DriverState[]) {
    this.world = new RAPIER.World({ x: 0, y: 0 });
    this.world.timestep = 1 / 120;
    this.world.integrationParameters.maxCcdSubsteps = 4;

    this.playerBody = this.createDynamicCar(playerStart.x, playerStart.y, playerStart.heading);
    this.aiBodies = ai.map((driver) => {
      const pose = sampleTrack(driver.progress, driver.laneOffset);
      return this.createDynamicCar(pose.x, pose.y, pose.heading);
    });
  }

  drivePlayer(input: ArcadeCarInput, dt: number): void {
    this.driveBody(this.playerBody, input, dt, 1);
  }

  driveAi(index: number, input: ArcadeCarInput, dt: number): void {
    const body = this.aiBodies[index];
    if (!body) return;
    // AI uses exactly the same vehicle controller. A slightly softer response
    // prevents its steering loop from fighting collision impulses every 120 Hz.
    this.driveBody(body, input, dt, 0.78);
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();

    this.limitSpin(this.playerBody, 1.45);
    for (const body of this.aiBodies) this.limitSpin(body, 1.35);
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

    // Do not overwrite a collision impulse with a perfect controller velocity
    // on the very next tick. Blend toward driver intent so two dynamic cars can
    // rub, separate and continue rather than buzzing against each other.
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
      .setAngularDamping(0.92)
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setAdditionalSolverIterations(4);
    const body = this.world.createRigidBody(bodyDesc);
    const collider = RAPIER.ColliderDesc.cuboid(CAR_HALF_LENGTH, CAR_HALF_WIDTH)
      .setDensity(0.025)
      .setFriction(0.025)
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

  private stopBody(body: RAPIER.RigidBody): void {
    body.setLinvel({ x: 0, y: 0 }, true);
    body.setAngvel(0, true);
  }

  private limitSpin(body: RAPIER.RigidBody, maximum: number): void {
    const yaw = body.angvel();
    if (Math.abs(yaw) > maximum) body.setAngvel(Math.sign(yaw) * maximum, true);
  }
}
