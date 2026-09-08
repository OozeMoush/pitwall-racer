import * as THREE from 'three';
import { createFormulaCar, type FormulaCar3D } from '../rendering3d/Car3D';
import { createPitLane3D } from '../rendering3d/PitLane3D';
import { createTrack3D } from '../rendering3d/Track3D';
import { headingToYaw, headingVector, toWorld } from '../rendering3d/WorldTransform';
import { resolvePlayerTraffic } from '../simulation/BattleModel';
import { createEnergy, stepEnergy, type EnergyState } from '../simulation/EnergyModel';
import { stepSteering } from '../simulation/InputModel';
import {
  PIT_SPEED,
  beginPitStop,
  createPitStopState,
  isPitActive,
  pitLanePose,
  shouldEnterPit,
  stepPitStop,
  type PitStopState,
} from '../simulation/PitLaneModel';
import { createRaceFlow, finishRaceFlow, raceBanner, stepRaceFlow, type RaceFlowState } from '../simulation/RaceFlow';
import { canRecover } from '../simulation/RecoveryModel';
import { twoCompoundWarning } from '../simulation/RuleFeedback';
import { selectStartingTyre } from '../simulation/StrategySelection';
import { surfaceEffect } from '../simulation/SurfaceModel';
import { createTire, stepTire, type Compound, type PaceMode, type TireState } from '../simulation/TireModel';
import { createVehicle, stepVehicle, type VehicleState } from '../simulation/VehicleModel';
import {
  aeroEffect,
  classify,
  createAiField,
  isTwoCompoundLegal,
  stepAiField,
  type DriverState,
  type RaceTrafficCar,
} from '../simulation/RaceModel';
import { completeLap, createTiming, formatLapTime, stepTiming, type TimingState } from '../simulation/TimingModel';
import { projectTrack, sampleTrack } from '../simulation/TrackModel';

const TOTAL_LAPS = 8;
const FIXED_DT = 1 / 120;
const AI_COLORS = [0xe64c4c, 0xe8e8e5, 0x54cf88, 0x9f72e6, 0xf3a341, 0x5d8fe8, 0xf064ad];

export class ThreeRaceGame {
  private readonly container: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 350);
  private readonly keys = new Set<string>();
  private readonly playerCar: FormulaCar3D;
  private readonly aiCars: FormulaCar3D[];
  private readonly cameraTarget = new THREE.Vector3();
  private lastFrame = performance.now();
  private fixedAccumulator = 0;

  private ai: DriverState[] = createAiField();
  private vehicle: VehicleState = this.startVehicle();
  private tire: TireState = createTire('MEDIUM');
  private energy: EnergyState = createEnergy();
  private timing: TimingState = createTiming();
  private flow: RaceFlowState = createRaceFlow();
  private pitStop: PitStopState = createPitStopState();
  private pace: PaceMode = 'BALANCED';
  private selectedCompound: Compound = 'SOFT';
  private usedCompounds = new Set<Compound>(['MEDIUM']);
  private lap = 1;
  private trackProgress = 0;
  private lastTrackProgress = 0;
  private nextCheckpoint = 1;
  private pitRequested = false;
  private finishMessage = '';
  private steerInput = 0;
  private trackDistance = 0;
  private trafficPressure = 0;
  private contactIntensity = 0;

  constructor(container: HTMLElement, hud: HTMLElement) {
    this.container = container;
    this.hud = hud;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.setupWorld();
    this.playerCar = createFormulaCar(0x31b9ef, this.tire.compound, true);
    this.scene.add(this.playerCar.root);
    this.aiCars = this.ai.map((driver, index) => {
      const car = createFormulaCar(AI_COLORS[index] ?? 0xffffff, driver.tire.compound);
      this.scene.add(car.root);
      return car;
    });

    this.bindInput();
    this.resize();
    window.addEventListener('resize', this.resize);
    this.syncVisuals(true);
    requestAnimationFrame(this.frame);
  }

  private setupWorld(): void {
    this.scene.background = new THREE.Color(0x8fb0ba);
    this.scene.fog = new THREE.Fog(0x8fb0ba, 75, 180);

    const hemisphere = new THREE.HemisphereLight(0xdceef3, 0x29402d, 1.45);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight(0xfff1d5, 3.2);
    sun.position.set(-38, 68, 24);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -75;
    sun.shadow.camera.right = 75;
    sun.shadow.camera.top = 60;
    sun.shadow.camera.bottom = -60;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 160;
    this.scene.add(sun);

    this.scene.add(createTrack3D());
    this.scene.add(createPitLane3D());
  }

  private bindInput(): void {
    window.addEventListener('keydown', (event) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      this.keys.add(event.code);
      if (event.repeat) return;

      if (event.code === 'Digit1') this.pace = 'CONSERVE';
      if (event.code === 'Digit2') this.pace = 'BALANCED';
      if (event.code === 'Digit3') this.pace = 'PUSH';
      if (event.code === 'Digit4') this.chooseCompound('SOFT');
      if (event.code === 'Digit5') this.chooseCompound('MEDIUM');
      if (event.code === 'Digit6') this.chooseCompound('HARD');
      if (event.code === 'KeyP' && this.flow.phase === 'RACING' && !isPitActive(this.pitStop)) this.pitRequested = !this.pitRequested;
      if (event.code === 'KeyR') this.handleRecoveryOrRestart();
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private readonly resize = (): void => {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  private readonly frame = (now: number): void => {
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;

    if (this.flow.phase !== 'FINISHED') {
      this.fixedAccumulator += dt;
      while (this.fixedAccumulator >= FIXED_DT) {
        this.stepSimulation(FIXED_DT);
        this.fixedAccumulator -= FIXED_DT;
      }
    }

    this.syncVisuals(false);
    this.updateCamera(dt);
    this.renderHud();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.frame);
  };

  private stepSimulation(dt: number): void {
    this.flow = stepRaceFlow(this.flow, dt);
    if (this.flow.phase !== 'RACING') {
      this.vehicle = { ...this.vehicle, speed: 0, yawRate: 0 };
      this.steerInput = 0;
      return;
    }

    this.timing = stepTiming(this.timing, dt);
    const playerProjection = projectTrack(this.vehicle.x, this.vehicle.y);
    const playerTraffic: RaceTrafficCar[] = isPitActive(this.pitStop)
      ? []
      : [{
          id: 'player',
          lap: this.lap,
          progress: playerProjection.progress,
          speed: this.vehicle.speed,
          laneOffset: playerProjection.laneOffset,
          performance: this.tire.grip * (this.pace === 'PUSH' ? 1.03 : this.pace === 'CONSERVE' ? 0.97 : 1),
          isPlayer: true,
        }];
    this.ai = stepAiField(this.ai, dt, TOTAL_LAPS, playerTraffic);

    if (this.stepPhysicalPit(dt)) return;

    const throttle = this.keys.has('KeyW') ? 1 : 0;
    const brake = this.keys.has('KeyS') ? 1 : 0;
    const rawSteer = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    this.steerInput = stepSteering(this.steerInput, rawSteer, this.vehicle.speed, dt);

    const track = projectTrack(this.vehicle.x, this.vehicle.y);
    const surface = surfaceEffect(track.distance);
    this.trackDistance = track.distance;
    this.lastTrackProgress = this.trackProgress;
    this.trackProgress = track.progress;
    this.updateLapAndCheckpoints(track.distance);

    if (shouldEnterPit(this.lastTrackProgress, this.trackProgress, track.distance, this.pitRequested)) {
      this.pitStop = beginPitStop();
      this.pitRequested = false;
      this.steerInput = 0;
      return;
    }

    const aero = aeroEffect(this.lap, this.trackProgress, this.ai);
    const battleLoad = this.trafficPressure * 0.16;
    const load = Math.min(1, Math.abs(this.steerInput) * 0.7 + throttle * 0.35 + brake * 0.55 + surface.severity * 0.6 + battleLoad);
    this.tire = stepTire(this.tire, this.pace, load + aero.dirtyAir * 0.45, dt);
    this.energy = stepEnergy(this.energy, {
      throttle,
      brake,
      speed: this.vehicle.speed,
      overtakeRequested: this.keys.has('Space'),
    }, dt);

    this.vehicle = stepVehicle(
      this.vehicle,
      { throttle, brake, steer: this.steerInput },
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

    const traffic = this.ai.filter((driver) => !driver.finished).map((driver) => {
      const p = sampleTrack(driver.progress, driver.laneOffset);
      return { x: p.x, y: p.y, heading: p.heading, speed: driver.speed };
    });
    const resolved = resolvePlayerTraffic(this.vehicle, traffic);
    this.vehicle = resolved.vehicle;
    this.trafficPressure = resolved.pressure;
    this.contactIntensity = resolved.contact;
  }

  private stepPhysicalPit(dt: number): boolean {
    if (!isPitActive(this.pitStop)) return false;

    const previous = this.pitStop;
    this.pitStop = stepPitStop(this.pitStop, dt);
    if (!previous.tyreChanged && this.pitStop.tyreChanged) {
      this.tire = createTire(this.selectedCompound);
      this.usedCompounds.add(this.selectedCompound);
      this.playerCar.setCompound(this.selectedCompound);
    }

    this.lastTrackProgress = this.trackProgress;
    const pose = pitLanePose(this.pitStop.t);
    this.trackProgress = pose.raceProgress;
    this.trackDistance = 0;
    this.updateLapAndCheckpoints(0);
    this.steerInput = 0;
    this.trafficPressure = 0;
    this.contactIntensity = 0;

    const speed = this.pitStop.phase === 'SERVICE' ? 0 : PIT_SPEED;
    this.vehicle = { ...createVehicle(pose.x, pose.y, pose.heading), speed };

    if (this.pitStop.phase === 'DONE') {
      const exit = pitLanePose(1);
      this.vehicle = { ...createVehicle(exit.x, exit.y, exit.heading), speed: PIT_SPEED };
      this.pitStop = createPitStopState();
    }
    return true;
  }

  private updateLapAndCheckpoints(distanceFromLine: number): void {
    if (distanceFromLine > 105) return;
    const thresholds = [0, 0.24, 0.49, 0.74];
    if (this.nextCheckpoint <= 3 && this.trackProgress >= thresholds[this.nextCheckpoint]) this.nextCheckpoint += 1;

    const crossedStart = this.nextCheckpoint === 4 && this.lastTrackProgress > 0.88 && this.trackProgress < 0.12;
    if (!crossedStart) return;

    this.timing = completeLap(this.timing);
    this.lap += 1;
    this.nextCheckpoint = 1;

    if (this.lap > TOTAL_LAPS) {
      const legal = isTwoCompoundLegal(this.usedCompounds);
      const standings = this.standings();
      const position = standings.findIndex((driver) => driver.id === 'player') + 1;
      this.flow = finishRaceFlow(this.flow);
      this.finishMessage = legal ? `P${position} · FINISH` : `P${position} · DISQUALIFIED`;
      this.vehicle = { ...this.vehicle, speed: 0 };
    }
  }

  private syncVisuals(initial: boolean): void {
    const playerPos = toWorld(this.vehicle.x, this.vehicle.y, 0.08);
    this.playerCar.root.position.copy(playerPos);
    this.playerCar.root.rotation.y = headingToYaw(this.vehicle.heading);
    this.playerCar.root.rotation.z = -this.steerInput * Math.min(0.055, this.vehicle.speed / 1800);

    this.ai.forEach((driver, index) => {
      const p = sampleTrack(driver.progress, driver.laneOffset);
      const world = toWorld(p.x, p.y, 0.08);
      const car = this.aiCars[index];
      car.root.position.copy(world);
      car.root.rotation.y = headingToYaw(p.heading);
      car.root.rotation.z = driver.battleState === 'ATTACK'
        ? 0.025
        : driver.battleState === 'DEFEND'
          ? -0.015
          : driver.battleState === 'SIDE_BY_SIDE'
            ? 0.012
            : 0;
      car.setCompound(driver.tire.compound);
    });

    if (initial) {
      const forward = headingVector(this.vehicle.heading);
      this.camera.position.copy(playerPos).addScaledVector(forward, -13).add(new THREE.Vector3(0, 15, 0));
      this.cameraTarget.copy(playerPos).addScaledVector(forward, 5);
      this.camera.lookAt(this.cameraTarget);
    }
  }

  private updateCamera(dt: number): void {
    const position = toWorld(this.vehicle.x, this.vehicle.y, 0.25);
    const forward = headingVector(this.vehicle.heading);
    const speedRatio = Math.min(1, this.vehicle.speed / 100);
    const desired = position.clone()
      .addScaledVector(forward, -(11.5 + speedRatio * 4.5))
      .add(new THREE.Vector3(0, 13.5 + speedRatio * 2.5, 0));
    const desiredTarget = position.clone().addScaledVector(forward, 5.5 + speedRatio * 5.5);
    const cameraLerp = 1 - Math.exp(-dt * 4.5);
    const targetLerp = 1 - Math.exp(-dt * 6.2);
    this.camera.position.lerp(desired, cameraLerp);
    this.cameraTarget.lerp(desiredTarget, targetLerp);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 49 + speedRatio * 7, 1 - Math.exp(-dt * 3));
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.cameraTarget);
  }

  private chooseCompound(compound: Compound): void {
    if (this.flow.phase === 'COUNTDOWN') {
      const selection = selectStartingTyre(compound);
      this.tire = createTire(selection.startCompound);
      this.usedCompounds = new Set([selection.startCompound]);
      this.selectedCompound = selection.suggestedNextCompound;
      this.playerCar.setCompound(selection.startCompound);
      return;
    }
    if (this.flow.phase === 'RACING' && !isPitActive(this.pitStop)) this.selectedCompound = compound;
  }

  private handleRecoveryOrRestart(): void {
    if (this.flow.phase === 'FINISHED') {
      this.resetRace();
      return;
    }
    if (isPitActive(this.pitStop)) return;
    if (this.flow.phase !== 'RACING' || !canRecover(this.trackDistance, this.vehicle.speed)) return;
    const p = sampleTrack(this.trackProgress);
    this.vehicle = createVehicle(p.x, p.y, p.heading);
    this.steerInput = 0;
    this.trackDistance = 0;
  }

  private resetRace(): void {
    this.ai = createAiField();
    this.vehicle = this.startVehicle();
    this.tire = createTire('MEDIUM');
    this.energy = createEnergy();
    this.timing = createTiming();
    this.flow = createRaceFlow();
    this.pitStop = createPitStopState();
    this.pace = 'BALANCED';
    this.selectedCompound = 'SOFT';
    this.usedCompounds = new Set(['MEDIUM']);
    this.lap = 1;
    this.trackProgress = 0;
    this.lastTrackProgress = 0;
    this.nextCheckpoint = 1;
    this.pitRequested = false;
    this.finishMessage = '';
    this.steerInput = 0;
    this.trackDistance = 0;
    this.trafficPressure = 0;
    this.contactIntensity = 0;
    this.fixedAccumulator = 0;
    this.playerCar.setCompound('MEDIUM');
    this.syncVisuals(true);
  }

  private startVehicle(): VehicleState {
    const start = sampleTrack(0);
    return createVehicle(start.x, start.y, start.heading);
  }

  private standings() {
    return classify([
      { id: 'player', name: 'YOU', lap: this.lap, progress: this.trackProgress },
      ...this.ai.map((driver) => ({ id: driver.id, name: driver.name, lap: driver.lap, progress: driver.progress })),
    ]);
  }

  private renderHud(): void {
    const standings = this.standings();
    const position = standings.findIndex((driver) => driver.id === 'player') + 1;
    const surface = surfaceEffect(this.trackDistance);
    const aero = aeroEffect(this.lap, this.trackProgress, this.ai);
    const banner = raceBanner(this.flow);
    const legal = isTwoCompoundLegal(this.usedCompounds);
    const obligation = this.flow.phase === 'RACING'
      ? twoCompoundWarning(this.usedCompounds, this.tire.compound, this.selectedCompound, this.lap, TOTAL_LAPS, this.pitRequested || isPitActive(this.pitStop))
      : undefined;
    const recovery = this.flow.phase === 'RACING' && !isPitActive(this.pitStop) && canRecover(this.trackDistance, this.vehicle.speed);
    const speed = Math.round(this.vehicle.speed * 3.6);
    const energyPct = Math.round(this.energy.soc * 100);
    const wearPct = Math.round(this.tire.wear * 100);
    const compoundHistory = [...this.usedCompounds].join(' → ');
    const delta = this.timing.deltaToBest === undefined ? '—' : `${this.timing.deltaToBest >= 0 ? '+' : ''}${this.timing.deltaToBest.toFixed(3)}`;
    const pitLabel = this.flow.phase === 'COUNTDOWN'
      ? `START ${this.tire.compound} · 4/5/6`
      : this.pitStop.phase === 'SERVICE'
        ? `PIT BOX · ${this.pitStop.serviceRemaining.toFixed(1)}s`
        : isPitActive(this.pitStop)
          ? `PIT LANE · ${this.pitStop.phase === 'TRANSIT_IN' ? 'IN' : 'OUT'}`
          : this.pitRequested
            ? `BOX THIS LAP → ${this.selectedCompound}`
            : `NEXT ${this.selectedCompound} · P TO BOX`;
    const raceState = surface.label !== 'TRACK'
      ? surface.label
      : this.contactIntensity > 0.08
        ? 'CONTACT'
        : this.trafficPressure > 0.18
          ? 'SIDE BY SIDE'
          : aero.dirtyAir > 0.01
            ? `DIRTY AIR ${(aero.dirtyAir * 100).toFixed(0)}%`
            : 'CLEAN AIR';
    const energyMode = this.energy.overtakeActive ? 'OVERTAKE' : this.energy.harvesting > this.energy.deployment ? 'HARVEST' : 'DEPLOY';

    const bannerHtml = banner ? `<div class="race-banner ${banner === 'GO' ? 'go' : ''}">${banner}</div>` : '';
    const finishHtml = this.flow.phase === 'FINISHED'
      ? `<div class="finish-card"><strong>${this.finishMessage}</strong><span>${legal ? 'LEGAL' : 'TWO COMPOUNDS REQUIRED'} · ${compoundHistory}</span><small>BEST ${formatLapTime(this.timing.bestLapTime)} · PRESS R TO RACE AGAIN</small></div>`
      : '';
    const warningHtml = obligation ? `<div class="race-warning">${obligation}</div>` : '';
    const recoveryHtml = recovery ? `<div class="recovery">STRANDED · PRESS R TO RECOVER</div>` : '';

    this.hud.innerHTML = `${bannerHtml}${finishHtml}${warningHtml}${recoveryHtml}
      <div class="hud-top">
        <div class="race-id"><b>PITWALL RACER</b><span>P${position} · LAP ${Math.min(this.lap, TOTAL_LAPS)}/${TOTAL_LAPS}</span></div>
        <div class="timing-strip"><span>LAST <b>${formatLapTime(this.timing.lastLapTime)}</b></span><span>BEST <b>${formatLapTime(this.timing.bestLapTime)}</b></span><span>Δ <b>${delta}</b></span></div>
      </div>
      <div class="tower">${standings.map((driver, index) => `<span class="${driver.id === 'player' ? 'you' : ''}"><i>${index + 1}</i>${driver.name}</span>`).join('')}</div>
      <div class="hud-bottom">
        <div class="speedo"><strong>${speed}</strong><span>KM/H</span></div>
        <div class="race-data">
          <div><small>PACE</small><b>${this.pace}</b></div>
          <div><small>TYRE</small><b class="tyre-${this.tire.compound.toLowerCase()}">${this.tire.compound}</b><span>${wearPct}% USED</span></div>
          <div><small>ENERGY</small><b>${energyPct}%</b><span>${energyMode}</span></div>
          <div><small>RACE</small><b>${raceState}</b><span>${pitLabel}</span></div>
        </div>
      </div>
      <div class="controls">WASD DRIVE · 1/2/3 PACE · SPACE OVERTAKE · 4/5/6 TYRE · P PIT</div>`;
  }
}
