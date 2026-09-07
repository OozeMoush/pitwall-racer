import Phaser from 'phaser';
import { compoundColor, createTire, stepTire, type PaceMode, type TireState } from '../simulation/TireModel';
import { createVehicle, stepVehicle, type VehicleState } from '../simulation/VehicleModel';

const W = 1600;
const H = 1000;

export class RaceScene extends Phaser.Scene {
  private car!: Phaser.GameObjects.Container;
  private vehicle: VehicleState = createVehicle(520, 770, -0.12);
  private tire: TireState = createTire('MEDIUM');
  private pace: PaceMode = 'BALANCED';
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private hud?: HTMLElement;
  private fixedAccumulator = 0;
  private readonly fixedDt = 1 / 120;

  constructor() { super('race'); }

  create(): void {
    this.cameras.main.setBackgroundColor('#101713');
    this.drawTrack();
    this.car = this.makeCar(520, 770, 0x4cc9ff);
    this.cameras.main.startFollow(this.car, true, 0.075, 0.075);
    this.cameras.main.setZoom(1.02);
    this.cameras.main.setBounds(0, 0, W, H);

    const keyboard = this.input.keyboard!;
    this.keys = {
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      push: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
      balanced: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
      conserve: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
    };
    this.hud = document.querySelector('#hud') ?? undefined;
  }

  update(_: number, deltaMs: number): void {
    if (Phaser.Input.Keyboard.JustDown(this.keys.push)) this.pace = 'PUSH';
    if (Phaser.Input.Keyboard.JustDown(this.keys.balanced)) this.pace = 'BALANCED';
    if (Phaser.Input.Keyboard.JustDown(this.keys.conserve)) this.pace = 'CONSERVE';

    this.fixedAccumulator += Math.min(deltaMs / 1000, 0.05);
    while (this.fixedAccumulator >= this.fixedDt) {
      const throttle = this.keys.up.isDown ? 1 : 0;
      const brake = this.keys.down.isDown ? 1 : 0;
      const steer = (this.keys.right.isDown ? 1 : 0) - (this.keys.left.isDown ? 1 : 0);
      const load = Math.min(1, Math.abs(steer) * 0.7 + throttle * 0.35 + brake * 0.55);
      this.tire = stepTire(this.tire, this.pace, load, this.fixedDt);
      this.vehicle = stepVehicle(this.vehicle, { throttle, brake, steer }, this.tire, this.fixedDt);
      this.fixedAccumulator -= this.fixedDt;
    }

    this.car.setPosition(this.vehicle.x, this.vehicle.y);
    this.car.setRotation(this.vehicle.heading);
    this.renderHud();
  }

  private drawTrack(): void {
    const g = this.add.graphics();
    g.fillStyle(0x16251b, 1).fillRect(0, 0, W, H);
    g.lineStyle(154, 0x34383b, 1);
    g.strokeRoundedRect(250, 170, 1100, 660, 250);
    g.lineStyle(4, 0x62686b, 0.9);
    g.strokeRoundedRect(250, 170, 1100, 660, 250);
    g.lineStyle(2, 0xf3f4e8, 0.22);
    g.strokeRoundedRect(250, 170, 1100, 660, 250);

    for (let i = 0; i < 14; i++) {
      const x = 470 + i * 55;
      g.fillStyle(i % 2 ? 0xf4f0e8 : 0xe74343, 1).fillRect(x, 748, 55, 12);
    }
    g.fillStyle(0x20292a, 1).fillRect(590, 240, 420, 120);
    g.fillStyle(0xd9ded6, 0.14).fillRect(610, 258, 380, 12);
    this.add.text(630, 292, 'PITWALL // TEST CIRCUIT', { fontFamily: 'Arial', fontSize: '22px', color: '#7f8c83' });
  }

  private makeCar(x: number, y: number, color: number): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const shadow = this.add.rectangle(5, 5, 48, 19, 0x000000, 0.35).setOrigin(0.5);
    const body = this.add.polygon(0, 0, [24,0, 10,-8,-10,-7,-23,-11,-26,-7,-15,-3,-15,3,-26,7,-23,11,-10,7,10,8], color, 1);
    const cockpit = this.add.ellipse(-2, 0, 13, 10, 0x11171a, 1);
    const nose = this.add.rectangle(18, 0, 18, 5, 0xe8eef0, 0.8);
    c.add([shadow, body, cockpit, nose]);
    return c;
  }

  private renderHud(): void {
    if (!this.hud) return;
    const wear = Math.round(this.tire.wear * 100);
    const speed = Math.round(this.vehicle.speed * 3.6);
    const color = `#${compoundColor(this.tire.compound).toString(16).padStart(6, '0')}`;
    this.hud.innerHTML = `<div class="brand">PITWALL <b>RACER</b></div><div class="telemetry"><div><small>SPEED</small><strong>${speed}</strong><span>km/h</span></div><div><small>PACE</small><strong>${this.pace}</strong><span>1 / 2 / 3</span></div><div><small>TYRE</small><strong style="color:${color}">${this.tire.compound}</strong><span>${wear}% used</span></div><div><small>TEMP</small><strong>${this.tire.temperature.toFixed(0)}°</strong><span>grip ${(this.tire.grip * 100).toFixed(0)}%</span></div></div><div class="hint">WASD · 1 CONSERVE · 2 BALANCED · 3 PUSH</div>`;
  }
}
