import Phaser from 'phaser';
import type { TireState } from '../simulation/TireModel';
import type { VehicleState } from '../simulation/VehicleModel';

export class RaceEffects {
  private readonly scene: Phaser.Scene;
  private readonly skidLayer: Phaser.GameObjects.Graphics;
  private lastRear?: { leftX: number; leftY: number; rightX: number; rightY: number };
  private smokeCooldown = 0;
  private shakeCooldown = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.skidLayer = scene.add.graphics().setDepth(3);
  }

  update(vehicle: VehicleState, tire: TireState, steer: number, brake: number, offTrackDistance: number, deltaSeconds: number): void {
    this.smokeCooldown = Math.max(0, this.smokeCooldown - deltaSeconds);
    this.shakeCooldown = Math.max(0, this.shakeCooldown - deltaSeconds);

    const lateralDemand = Math.abs(steer) * Math.min(1, vehicle.speed / 55) + Math.abs(vehicle.yawRate) * 0.28;
    const lockDemand = brake * Math.min(1, vehicle.speed / 45);
    const slip = Math.max(lateralDemand, lockDemand);
    const rear = this.rearWheelPoints(vehicle);

    if (this.lastRear && vehicle.speed > 22 && slip > 0.48) {
      const alpha = Phaser.Math.Clamp((slip - 0.42) * 0.32, 0.035, 0.18);
      this.skidLayer.lineStyle(2, 0x111412, alpha);
      this.skidLayer.lineBetween(this.lastRear.leftX, this.lastRear.leftY, rear.leftX, rear.leftY);
      this.skidLayer.lineBetween(this.lastRear.rightX, this.lastRear.rightY, rear.rightX, rear.rightY);
    }
    this.lastRear = rear;

    const overheated = tire.temperature > 106;
    if (this.smokeCooldown === 0 && vehicle.speed > 18 && (slip > 0.8 || overheated && slip > 0.55)) {
      this.spawnSmoke((rear.leftX + rear.rightX) * 0.5, (rear.leftY + rear.rightY) * 0.5, vehicle.heading);
      this.smokeCooldown = 0.075;
    }

    if (offTrackDistance > 72 && vehicle.speed > 30 && this.shakeCooldown === 0) {
      const strength = Phaser.Math.Clamp((offTrackDistance - 65) / 300, 0.001, 0.006);
      this.scene.cameras.main.shake(85, strength);
      this.shakeCooldown = 0.12;
    }
  }

  private rearWheelPoints(vehicle: VehicleState) {
    const rearX = vehicle.x - Math.cos(vehicle.heading) * 17;
    const rearY = vehicle.y - Math.sin(vehicle.heading) * 17;
    const nx = -Math.sin(vehicle.heading) * 7;
    const ny = Math.cos(vehicle.heading) * 7;
    return {
      leftX: rearX + nx,
      leftY: rearY + ny,
      rightX: rearX - nx,
      rightY: rearY - ny,
    };
  }

  private spawnSmoke(x: number, y: number, heading: number): void {
    const puff = this.scene.add.circle(
      x - Math.cos(heading) * 4,
      y - Math.sin(heading) * 4,
      Phaser.Math.Between(4, 7),
      0xd8ded9,
      0.19,
    ).setDepth(4);

    this.scene.tweens.add({
      targets: puff,
      x: puff.x - Math.cos(heading) * 18 + Phaser.Math.Between(-7, 7),
      y: puff.y - Math.sin(heading) * 18 + Phaser.Math.Between(-7, 7),
      alpha: 0,
      scale: 2.4,
      duration: 620,
      ease: 'Sine.Out',
      onComplete: () => puff.destroy(),
    });
  }
}
