import Phaser from 'phaser';
import { RaceEffects } from '../rendering/RaceEffects';
import { compoundColor, createTire, stepTire, type Compound, type PaceMode, type TireState } from '../simulation/TireModel';
import { createVehicle, stepVehicle, type VehicleState } from '../simulation/VehicleModel';
import { aeroEffect, classify, createAiField, isTwoCompoundLegal, stepAiField, type DriverState } from '../simulation/RaceModel';
import { completeLap, createTiming, formatLapTime, stepTiming, type TimingState } from '../simulation/TimingModel';
import { nearestTrackProgress, RACING_LINE, sampleTrack } from '../simulation/TrackModel';

const W = 1600;
const H = 1000;
const TOTAL_LAPS = 8;

export class RaceScene extends Phaser.Scene {
  private car!: Phaser.GameObjects.Container;
  private effects!: RaceEffects;
  private aiCars: Phaser.GameObjects.Container[] = [];
  private ai: DriverState[] = createAiField();
  private vehicle: VehicleState = createVehicle(520, 753, 0);
  private tire: TireState = createTire('MEDIUM');
  private timing: TimingState = createTiming();
  private pace: PaceMode = 'BALANCED';
  private selectedCompound: Compound = 'SOFT';
  private usedCompounds = new Set<Compound>(['MEDIUM']);
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private hud?: HTMLElement;
  private fixedAccumulator = 0;
  private readonly fixedDt = 1 / 120;
  private lap = 1;
  private trackProgress = 0;
  private lastTrackProgress = 0;
  private nextCheckpoint = 1;
  private pitRequested = false;
  private pitTimer = 0;
  private raceFinished = false;
  private finishMessage = '';
  private renderSteer = 0;
  private renderBrake = 0;
  private trackDistance = 0;

  constructor() { super('race'); }

  create(): void {
    this.cameras.main.setBackgroundColor('#101713');
    this.drawTrack();
    this.effects = new RaceEffects(this);
    this.car = this.makeCar(520, 753, 0x4cc9ff, true);
    this.aiCars = this.ai.map((driver, i) => {
      const p = sampleTrack(driver.progress, driver.laneOffset);
      return this.makeCar(p.x, p.y, [0xff5c5c, 0xe7e7e7, 0x66e2a2, 0xbd8cff, 0xffae57, 0x69a8ff, 0xff77bc][i], false);
    });

    this.cameras.main.startFollow(this.car, true, 0.075, 0.075);
    this.cameras.main.setZoom(1.05);
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
      soft: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.FOUR),
      medium: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.FIVE),
      hard: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SIX),
      pit: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.P),
    };
    this.hud = document.querySelector('#hud') ?? undefined;
  }

  update(_: number, deltaMs: number): void {
    this.handleOneShotKeys();
    if (this.raceFinished) {
      this.renderHud();
      return;
    }

    this.fixedAccumulator += Math.min(deltaMs / 1000, 0.05);
    while (this.fixedAccumulator >= this.fixedDt) {
      this.stepSimulation(this.fixedDt);
      this.fixedAccumulator -= this.fixedDt;
    }

    this.car.setPosition(this.vehicle.x, this.vehicle.y);
    this.car.setRotation(this.vehicle.heading);
    this.ai.forEach((driver, i) => {
      const p = sampleTrack(driver.progress, driver.laneOffset);
      this.aiCars[i].setPosition(p.x, p.y).setRotation(p.heading);
      this.aiCars[i].setScale(driver.battleState === 'ATTACK' ? 1.06 : 1);
    });

    this.updateCameraAndEffects(Math.min(deltaMs / 1000, 0.05));
    this.renderHud();
  }

  private handleOneShotKeys(): void {
    if (Phaser.Input.Keyboard.JustDown(this.keys.push)) this.pace = 'PUSH';
    if (Phaser.Input.Keyboard.JustDown(this.keys.balanced)) this.pace = 'BALANCED';
    if (Phaser.Input.Keyboard.JustDown(this.keys.conserve)) this.pace = 'CONSERVE';
    if (Phaser.Input.Keyboard.JustDown(this.keys.soft)) this.selectedCompound = 'SOFT';
    if (Phaser.Input.Keyboard.JustDown(this.keys.medium)) this.selectedCompound = 'MEDIUM';
    if (Phaser.Input.Keyboard.JustDown(this.keys.hard)) this.selectedCompound = 'HARD';
    if (Phaser.Input.Keyboard.JustDown(this.keys.pit)) this.pitRequested = !this.pitRequested;
  }

  private stepSimulation(dt: number): void {
    this.timing = stepTiming(this.timing, dt);
    this.ai = stepAiField(this.ai, dt, TOTAL_LAPS);

    if (this.pitTimer > 0) {
      this.pitTimer = Math.max(0, this.pitTimer - dt);
      this.renderSteer = 0;
      this.renderBrake = 1;
      this.vehicle = { ...this.vehicle, speed: 0, yawRate: 0 };
      if (this.pitTimer === 0) {
        this.tire = createTire(this.selectedCompound);
        this.usedCompounds.add(this.selectedCompound);
        const release = sampleTrack(0.025, 38);
        this.vehicle = createVehicle(release.x, release.y, release.heading);
        this.trackProgress = 0.025;
        this.lastTrackProgress = 0.025;
      }
      return;
    }

    const throttle = this.keys.up.isDown ? 1 : 0;
    const brake = this.keys.down.isDown ? 1 : 0;
    const steer = (this.keys.right.isDown ? 1 : 0) - (this.keys.left.isDown ? 1 : 0);
    this.renderSteer = steer;
    this.renderBrake = brake;

    const track = nearestTrackProgress(this.vehicle.x, this.vehicle.y);
    this.trackDistance = track.distance;
    this.lastTrackProgress = this.trackProgress;
    this.trackProgress = track.progress;
    this.updateLapAndCheckpoints(track.distance);

    const aero = aeroEffect(this.lap, this.trackProgress, this.ai);
    const offTrackLoad = Math.min(0.6, Math.max(0, track.distance - 55) / 100);
    const load = Math.min(1, Math.abs(steer) * 0.7 + throttle * 0.35 + brake * 0.55 + offTrackLoad);
    this.tire = stepTire(this.tire, this.pace, load + aero.dirtyAir * 0.45, dt);
    this.vehicle = stepVehicle(this.vehicle, { throttle, brake, steer }, this.tire, dt, aero);
  }

  private updateCameraAndEffects(dt: number): void {
    const speedNorm = Phaser.Math.Clamp(this.vehicle.speed / 100, 0, 1);
    const lookAhead = 36 + speedNorm * 135;
    this.cameras.main.setFollowOffset(
      -Math.cos(this.vehicle.heading) * lookAhead,
      -Math.sin(this.vehicle.heading) * lookAhead,
    );

    const targetZoom = Phaser.Math.Linear(1.08, 0.9, speedNorm);
    this.cameras.main.setZoom(Phaser.Math.Linear(this.cameras.main.zoom, targetZoom, 0.035));
    this.effects.update(this.vehicle, this.tire, this.renderSteer, this.renderBrake, this.trackDistance, dt);
  }

  private updateLapAndCheckpoints(distanceFromLine: number): void {
    if (distanceFromLine > 105) return;
    const thresholds = [0, 0.24, 0.49, 0.74];
    if (this.nextCheckpoint <= 3 && this.trackProgress >= thresholds[this.nextCheckpoint]) {
      this.nextCheckpoint += 1;
    }

    const crossedStart = this.nextCheckpoint === 4 && this.lastTrackProgress > 0.88 && this.trackProgress < 0.12;
    if (!crossedStart) return;

    this.timing = completeLap(this.timing);
    this.lap += 1;
    this.nextCheckpoint = 1;
    if (this.pitRequested && this.lap <= TOTAL_LAPS) {
      this.pitRequested = false;
      this.pitTimer = 3.8;
    }

    if (this.lap > TOTAL_LAPS) {
      this.raceFinished = true;
      this.finishMessage = isTwoCompoundLegal(this.usedCompounds) ? 'FINISH' : 'DISQUALIFIED · TWO COMPOUNDS REQUIRED';
      this.vehicle = { ...this.vehicle, speed: 0 };
    }
  }

  private drawTrack(): void {
    const g = this.add.graphics();
    g.fillStyle(0x16251b, 1).fillRect(0, 0, W, H);
    g.lineStyle(154, 0x34383b, 1);
    g.strokeRoundedRect(250, 170, 1100, 660, 250);
    g.lineStyle(4, 0x62686b, 0.9);
    g.strokeRoundedRect(250, 170, 1100, 660, 250);
    g.lineStyle(2, 0xf3f4e8, 0.18);
    g.beginPath();
    RACING_LINE.forEach((p, i) => i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y));
    g.closePath();
    g.strokePath();

    for (let i = 0; i < 14; i++) {
      const x = 470 + i * 55;
      g.fillStyle(i % 2 ? 0xf4f0e8 : 0xe74343, 1).fillRect(x, 748, 55, 12);
    }
    g.lineStyle(4, 0xffffff, 0.8).lineBetween(520, 706, 520, 800);
    g.fillStyle(0x20292a, 1).fillRect(590, 240, 420, 120);
    g.fillStyle(0xd9ded6, 0.14).fillRect(610, 258, 380, 12);
    this.add.text(630, 292, 'PITWALL // TEST CIRCUIT', { fontFamily: 'Arial', fontSize: '22px', color: '#7f8c83' });
  }

  private makeCar(x: number, y: number, color: number, player: boolean): Phaser.GameObjects.Container {
    const c = this.add.container(x, y).setDepth(10);
    const shadow = this.add.rectangle(5, 5, 48, 19, 0x000000, 0.35).setOrigin(0.5);
    const body = this.add.polygon(0, 0, [24,0, 10,-8,-10,-7,-23,-11,-26,-7,-15,-3,-15,3,-26,7,-23,11,-10,7,10,8], color, 1);
    const cockpit = this.add.ellipse(-2, 0, 13, 10, 0x11171a, 1);
    const nose = this.add.rectangle(18, 0, 18, 5, player ? 0xffffff : 0xd8dde0, 0.9);
    c.add([shadow, body, cockpit, nose]);
    if (player) c.add(this.add.circle(-18, 0, 3, 0xffffff, 1));
    return c;
  }

  private renderHud(): void {
    if (!this.hud) return;
    const wear = Math.round(this.tire.wear * 100);
    const speed = Math.round(this.vehicle.speed * 3.6);
    const color = `#${compoundColor(this.tire.compound).toString(16).padStart(6, '0')}`;
    const aero = aeroEffect(this.lap, this.trackProgress, this.ai);
    const standings = classify([
      { id: 'player', name: 'YOU', lap: this.lap, progress: this.trackProgress },
      ...this.ai.map((d) => ({ id: d.id, name: d.name, lap: d.lap, progress: d.progress })),
    ]);
    const position = standings.findIndex((d) => d.id === 'player') + 1;
    const compoundHistory = [...this.usedCompounds].map((c) => c[0]).join(' / ');
    const pit = this.pitTimer > 0 ? `PIT STOP ${this.pitTimer.toFixed(1)}s` : this.pitRequested ? `BOX THIS LAP → ${this.selectedCompound}` : `NEXT ${this.selectedCompound} · P TO BOX`;
    const effect = aero.dirtyAir > 0.01 ? `DIRTY AIR ${(aero.dirtyAir * 100).toFixed(0)}% · TOW ${(aero.tow * 100).toFixed(0)}%` : 'CLEAN AIR';
    const finished = this.raceFinished ? `<div class="finish">${this.finishMessage}</div>` : '';
    const delta = this.timing.deltaToBest === undefined ? '' : `${this.timing.deltaToBest >= 0 ? '+' : ''}${this.timing.deltaToBest.toFixed(3)}`;
    const timingLine = `NOW ${formatLapTime(this.timing.currentLapTime)} · LAST ${formatLapTime(this.timing.lastLapTime)} · BEST ${formatLapTime(this.timing.bestLapTime)}${delta ? ` · Δ ${delta}` : ''}`;
    const battleCount = this.ai.filter((driver) => driver.battleState === 'ATTACK').length;

    this.hud.innerHTML = `${finished}<div class="brand">PITWALL <b>RACER</b><span>P${position} · LAP ${Math.min(this.lap, TOTAL_LAPS)}/${TOTAL_LAPS}</span></div><div class="telemetry"><div><small>SPEED</small><strong>${speed}</strong><span>km/h</span></div><div><small>PACE</small><strong>${this.pace}</strong><span>1 / 2 / 3</span></div><div><small>TYRE</small><strong style="color:${color}">${this.tire.compound}</strong><span>${wear}% used · ${compoundHistory}</span></div><div><small>TEMP</small><strong>${this.tire.temperature.toFixed(0)}°</strong><span>grip ${(this.tire.grip * 100).toFixed(0)}%</span></div></div><div class="strategy"><b>${pit}</b><span>${effect}</span><span>${timingLine}</span><span>${battleCount ? `${battleCount} AI BATTLE${battleCount > 1 ? 'S' : ''}` : 'FIELD SETTLED'}</span><span>4 SOFT · 5 MEDIUM · 6 HARD</span></div><div class="timing">${standings.map((d, i) => {
      const aiDriver = this.ai.find((driver) => driver.id === d.id);
      const marker = aiDriver?.battleState === 'ATTACK' ? ' ↗' : aiDriver?.battleState === 'FOLLOW' ? ' ·' : '';
      return `<span class="${d.id === 'player' ? 'you' : ''}">${i + 1}. ${d.name}${marker}</span>`;
    }).join('')}</div><div class="hint">WASD DRIVE · 1 CONSERVE · 2 BALANCED · 3 PUSH · P PIT</div>`;
  }
}
