import Phaser from 'phaser';
import { RaceEffects } from '../rendering/RaceEffects';
import { drawTrackSurface } from '../rendering/TrackRenderer';
import { resolvePlayerTraffic } from '../simulation/BattleModel';
import { createEnergy, stepEnergy, type EnergyState } from '../simulation/EnergyModel';
import { stepSteering } from '../simulation/InputModel';
import { createRaceFlow, finishRaceFlow, raceBanner, stepRaceFlow, type RaceFlowState } from '../simulation/RaceFlow';
import { twoCompoundWarning } from '../simulation/RuleFeedback';
import { selectStartingTyre } from '../simulation/StrategySelection';
import { surfaceEffect } from '../simulation/SurfaceModel';
import { compoundColor, createTire, stepTire, type Compound, type PaceMode, type TireState } from '../simulation/TireModel';
import { createVehicle, stepVehicle, type VehicleState } from '../simulation/VehicleModel';
import { aeroEffect, classify, createAiField, isTwoCompoundLegal, stepAiField, type DriverState } from '../simulation/RaceModel';
import { completeLap, createTiming, formatLapTime, stepTiming, type TimingState } from '../simulation/TimingModel';
import { nearestTrackProgress, sampleTrack } from '../simulation/TrackModel';

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
  private energy: EnergyState = createEnergy();
  private timing: TimingState = createTiming();
  private flow: RaceFlowState = createRaceFlow();
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
  private finishMessage = '';
  private steerInput = 0;
  private renderSteer = 0;
  private renderBrake = 0;
  private trackDistance = 0;
  private trafficPressure = 0;
  private contactIntensity = 0;

  constructor() { super('race'); }

  create(): void {
    this.cameras.main.setBackgroundColor('#101713');
    drawTrackSurface(this);
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
      overtake: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      restart: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R),
    };
    this.hud = document.querySelector('#hud') ?? undefined;
  }

  update(_: number, deltaMs: number): void {
    this.handleOneShotKeys();
    if (this.flow.phase === 'FINISHED') {
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
    if (this.flow.phase === 'FINISHED' && Phaser.Input.Keyboard.JustDown(this.keys.restart)) {
      this.scene.restart();
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.push)) this.pace = 'PUSH';
    if (Phaser.Input.Keyboard.JustDown(this.keys.balanced)) this.pace = 'BALANCED';
    if (Phaser.Input.Keyboard.JustDown(this.keys.conserve)) this.pace = 'CONSERVE';
    if (Phaser.Input.Keyboard.JustDown(this.keys.soft)) this.chooseCompound('SOFT');
    if (Phaser.Input.Keyboard.JustDown(this.keys.medium)) this.chooseCompound('MEDIUM');
    if (Phaser.Input.Keyboard.JustDown(this.keys.hard)) this.chooseCompound('HARD');
    if (this.flow.phase === 'RACING' && Phaser.Input.Keyboard.JustDown(this.keys.pit)) this.pitRequested = !this.pitRequested;
  }

  private chooseCompound(compound: Compound): void {
    if (this.flow.phase === 'COUNTDOWN') {
      const selection = selectStartingTyre(compound);
      this.tire = createTire(selection.startCompound);
      this.usedCompounds = new Set<Compound>([selection.startCompound]);
      this.selectedCompound = selection.suggestedNextCompound;
      return;
    }
    if (this.flow.phase === 'RACING') this.selectedCompound = compound;
  }

  private stepSimulation(dt: number): void {
    this.flow = stepRaceFlow(this.flow, dt);
    if (this.flow.phase !== 'RACING') {
      this.vehicle = { ...this.vehicle, speed: 0, yawRate: 0 };
      this.steerInput = 0;
      this.renderSteer = 0;
      this.renderBrake = 0;
      return;
    }

    this.timing = stepTiming(this.timing, dt);
    this.ai = stepAiField(this.ai, dt, TOTAL_LAPS);

    if (this.pitTimer > 0) {
      this.pitTimer = Math.max(0, this.pitTimer - dt);
      this.steerInput = 0;
      this.renderSteer = 0;
      this.renderBrake = 1;
      this.trafficPressure = 0;
      this.contactIntensity = 0;
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
    const rawSteer = (this.keys.right.isDown ? 1 : 0) - (this.keys.left.isDown ? 1 : 0);
    this.steerInput = stepSteering(this.steerInput, rawSteer, this.vehicle.speed, dt);
    const steer = this.steerInput;
    this.renderSteer = steer;
    this.renderBrake = brake;

    const track = nearestTrackProgress(this.vehicle.x, this.vehicle.y);
    const surface = surfaceEffect(track.distance);
    this.trackDistance = track.distance;
    this.lastTrackProgress = this.trackProgress;
    this.trackProgress = track.progress;
    this.updateLapAndCheckpoints(track.distance);

    const aero = aeroEffect(this.lap, this.trackProgress, this.ai);
    const battleLoad = this.trafficPressure * 0.16;
    const load = Math.min(1, Math.abs(steer) * 0.7 + throttle * 0.35 + brake * 0.55 + surface.severity * 0.6 + battleLoad);
    this.tire = stepTire(this.tire, this.pace, load + aero.dirtyAir * 0.45, dt);
    this.energy = stepEnergy(this.energy, {
      throttle,
      brake,
      speed: this.vehicle.speed,
      overtakeRequested: this.keys.overtake.isDown,
    }, dt);
    this.vehicle = stepVehicle(
      this.vehicle,
      { throttle, brake, steer },
      this.tire,
      dt,
      {
        tow: aero.tow,
        dirtyAir: aero.dirtyAir,
        powerBoost: this.energy.powerBoost,
        surfaceGrip: surface.gripMultiplier,
        powerMultiplier: surface.powerMultiplier,
        rollingResistance: surface.rollingResistance,
      },
    );

    const traffic = this.ai
      .filter((driver) => !driver.finished)
      .map((driver) => {
        const p = sampleTrack(driver.progress, driver.laneOffset);
        return { x: p.x, y: p.y, heading: p.heading, speed: driver.speed };
      });
    const resolved = resolvePlayerTraffic(this.vehicle, traffic);
    this.vehicle = resolved.vehicle;
    this.trafficPressure = resolved.pressure;
    this.contactIntensity = resolved.contact;
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
    if (this.contactIntensity > 0.08) {
      this.cameras.main.shake(45, 0.0012 + this.contactIntensity * 0.0018);
    }
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
      const legal = isTwoCompoundLegal(this.usedCompounds);
      const standings = classify([
        { id: 'player', lap: this.lap, progress: this.trackProgress },
        ...this.ai.map((d) => ({ id: d.id, lap: d.lap, progress: d.progress })),
      ]);
      const position = standings.findIndex((d) => d.id === 'player') + 1;
      this.flow = finishRaceFlow(this.flow);
      this.finishMessage = legal ? `P${position} · FINISH` : `P${position} · DISQUALIFIED`;
      this.vehicle = { ...this.vehicle, speed: 0 };
    }
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
    const surface = surfaceEffect(this.trackDistance);
    const standings = classify([
      { id: 'player', name: 'YOU', lap: this.lap, progress: this.trackProgress },
      ...this.ai.map((d) => ({ id: d.id, name: d.name, lap: d.lap, progress: d.progress })),
    ]);
    const position = standings.findIndex((d) => d.id === 'player') + 1;
    const compoundHistory = [...this.usedCompounds].map((c) => c[0]).join(' / ');
    const pit = this.flow.phase === 'COUNTDOWN'
      ? `START ${this.tire.compound} · NEXT ${this.selectedCompound}`
      : this.pitTimer > 0
        ? `PIT STOP ${this.pitTimer.toFixed(1)}s`
        : this.pitRequested
          ? `BOX THIS LAP → ${this.selectedCompound}`
          : `NEXT ${this.selectedCompound} · P TO BOX`;
    const obligation = this.flow.phase === 'RACING'
      ? twoCompoundWarning(this.usedCompounds, this.tire.compound, this.selectedCompound, this.lap, TOTAL_LAPS, this.pitRequested)
      : undefined;
    const effect = aero.dirtyAir > 0.01 ? `DIRTY AIR ${(aero.dirtyAir * 100).toFixed(0)}% · TOW ${(aero.tow * 100).toFixed(0)}%` : 'CLEAN AIR';
    const delta = this.timing.deltaToBest === undefined ? '' : `${this.timing.deltaToBest >= 0 ? '+' : ''}${this.timing.deltaToBest.toFixed(3)}`;
    const timingLine = `NOW ${formatLapTime(this.timing.currentLapTime)} · LAST ${formatLapTime(this.timing.lastLapTime)} · BEST ${formatLapTime(this.timing.bestLapTime)}${delta ? ` · Δ ${delta}` : ''}`;
    const battleCount = this.ai.filter((driver) => driver.battleState === 'ATTACK').length;
    const energyMode = this.energy.overtakeActive ? 'OVERTAKE' : this.energy.harvesting > this.energy.deployment ? 'HARVEST' : 'DEPLOY';
    const energyPct = Math.round(this.energy.soc * 100);
    const battle = surface.label !== 'TRACK'
      ? surface.label
      : this.contactIntensity > 0.08
        ? 'CONTACT'
        : this.trafficPressure > 0.18
          ? 'SIDE BY SIDE'
          : effect;
    const banner = raceBanner(this.flow);
    const startOverlay = banner ? `<div class="race-banner ${banner === 'GO' ? 'go' : ''}">${banner}</div>` : '';
    const finishOverlay = this.flow.phase === 'FINISHED'
      ? `<div class="finish"><div><strong>${this.finishMessage}</strong><span>BEST ${formatLapTime(this.timing.bestLapTime)} · ${[...this.usedCompounds].join(' → ')}</span><small>PRESS R TO RACE AGAIN</small></div></div>`
      : '';
    const tyreHint = this.flow.phase === 'COUNTDOWN' ? '4/5/6 START TYRE' : '4/5/6 NEXT TYRE';
    const obligationHtml = obligation ? `<span class="warning">${obligation}</span>` : '';

    this.hud.innerHTML = `${startOverlay}${finishOverlay}<div class="brand">PITWALL <b>RACER</b><span>P${position} · LAP ${Math.min(this.lap, TOTAL_LAPS)}/${TOTAL_LAPS}</span></div><div class="telemetry"><div><small>SPEED</small><strong>${speed}</strong><span>km/h</span></div><div><small>PACE</small><strong>${this.pace}</strong><span>1 / 2 / 3</span></div><div><small>TYRE</small><strong style="color:${color}">${this.tire.compound}</strong><span>${wear}% used · ${compoundHistory}</span></div><div><small>TEMP</small><strong>${this.tire.temperature.toFixed(0)}°</strong><span>grip ${(this.tire.grip * 100).toFixed(0)}%</span></div><div><small>ENERGY</small><strong>${energyPct}%</strong><span>${energyMode} · HOLD SPACE</span></div></div><div class="strategy"><b>${pit}</b>${obligationHtml}<span>${battle}</span><span>${timingLine}</span><span>${battleCount ? `${battleCount} AI BATTLE${battleCount > 1 ? 'S' : ''}` : 'FIELD SETTLED'}</span><span>${tyreHint}</span></div><div class="timing">${standings.map((d, i) => {
      const aiDriver = this.ai.find((driver) => driver.id === d.id);
      const marker = aiDriver?.battleState === 'ATTACK' ? ' ↗' : aiDriver?.battleState === 'FOLLOW' ? ' ·' : '';
      return `<span class="${d.id === 'player' ? 'you' : ''}">${i + 1}. ${d.name}${marker}</span>`;
    }).join('')}</div><div class="hint">WASD DRIVE · 1/2/3 PACE · HOLD SPACE OVERTAKE · P PIT · R RESTART AFTER FINISH</div>`;
  }
}
