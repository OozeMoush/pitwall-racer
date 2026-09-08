import RAPIER from '@dimforge/rapier2d-compat';
import { controlArcadeCar, type ArcadeCarInput } from './ArcadeCarController';
import type { DriverState } from './RaceModel';
import { sampleTrack } from './TrackModel';
import type { VehicleState } from './VehicleModel';

const PLAYER_HALF_LENGTH = 14;
const PLAYER_HALF_WIDTH = 6.4;
const AI_HALF_LENGTH = 14;
const AI_HALF_WIDTH = 6.4;

export class RapierRacePhysics {
  readonly world: RAPIER.World;
  private readonly playerBody: RAPIER.RigidBody;
  private readonly aiBodies: RAPIER.RigidBody[];

  constructor(playerStart: VehicleState, ai: readonly DriverState[]) {
    this.world = new RAPIER.World({ x: 0, y: 0 });
    this.world.timestep = 1 / 120;
    this.world.integrationParameters.maxCcdSubsteps = 2;

    this.playerBody = this.createDynamicCar(playerStart.x, playerStart.y, playerStart.heading);
    this.aiBodies = ai.map((driver) => {
      const pose = sampleTrack(driver.progress, driver.laneOffset);
      return this.createKinematicCar(pose.x, pose.y, pose.heading);
    });
  }

  drivePlayer(input: ArcadeCarInput, dt: number): void {
    const body = this.playerBody;
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

    body.setLinvel({ x: controlled.vx, y: controlled.vy }, true);
    body.setAngvel(controlled.angularVelocity, true);
  }

  syncAiKinematics(ai: readonly DriverState[]): void {
    ai.forEach((driver, index) => {
      const body = this.aiBodies[index];
      if (!body) return;
      const pose = sampleTrack(driver.progress, driver.laneOffset);
      body.setNextKinematicTranslation({ x: pose.x, y: pose.y });
      body.setNextKinematicRotation(pose.heading);
    });
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();

    // Keep contact-induced spins recoverable. Rapier still owns the collision;
    // this is only an arcade safety ceiling on extreme angular velocity.
    const yaw = this.playerBody.angvel();
    if (Math.abs(yaw) > 1.65) this.playerBody.setAngvel(Math.sign(yaw) * 1.65, true);
  }

  playerState(): VehicleState {
    const position = this.playerBody.translation();
    const velocity = this.playerBody.linvel();
    return {
      x: position.x,
      y: position.y,
      heading: this.playerBody.rotation(),
      speed: Math.hypot(velocity.x, velocity.y),
      yawRate: this.playerBody.angvel(),
    };
  }

  setPlayerState(state: VehicleState): void {
    this.playerBody.setTranslation({ x: state.x, y: state.y }, true);
    this.playerBody.setRotation(state.heading, true);
    this.playerBody.setLinvel({
      x: Math.cos(state.heading) * state.speed,
      y: Math.sin(state.heading) * state.speed,
    }, true);
    this.playerBody.setAngvel(state.yawRate, true);
  }

  stopPlayer(): void {
    this.playerBody.setLinvel({ x: 0, y: 0 }, true);
    this.playerBody.setAngvel(0, true);
  }

  reset(playerStart: VehicleState, ai: readonly DriverState[]): void {
    this.setPlayerState(playerStart);
    this.syncAiImmediate(ai);
  }

  private createDynamicCar(x: number, y: number, heading: number): RAPIER.RigidBody {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setRotation(heading)
      .setLinearDamping(0.02)
      .setAngularDamping(0.75)
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setAdditionalSolverIterations(2);
    const body = this.world.createRigidBody(bodyDesc);
    const collider = RAPIER.ColliderDesc.cuboid(PLAYER_HALF_LENGTH, PLAYER_HALF_WIDTH)
      .setDensity(0.02)
      .setFriction(0.08)
      .setRestitution(0.02);
    this.world.createCollider(collider, body);
    return body;
  }

  private createKinematicCar(x: number, y: number, heading: number): RAPIER.RigidBody {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(x, y)
      .setRotation(heading)
      .setCanSleep(false);
    const body = this.world.createRigidBody(bodyDesc);
    const collider = RAPIER.ColliderDesc.cuboid(AI_HALF_LENGTH, AI_HALF_WIDTH)
      .setFriction(0.06)
      .setRestitution(0.015);
    this.world.createCollider(collider, body);
    return body;
  }

  private syncAiImmediate(ai: readonly DriverState[]): void {
    ai.forEach((driver, index) => {
      const body = this.aiBodies[index];
      if (!body) return;
      const pose = sampleTrack(driver.progress, driver.laneOffset);
      body.setTranslation({ x: pose.x, y: pose.y }, false);
      body.setRotation(pose.heading, false);
    });
  }
}
