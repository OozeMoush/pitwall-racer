import * as THREE from 'three';
import { RaceAudio } from '../audio/RaceAudio';
import { AiReferenceGhost } from '../simulation/AiReferenceGhost';
import { createFormulaCar, type FormulaCar3D } from '../rendering3d/Car3D';
import { createPitLane3D } from '../rendering3d/PitLane3D';
import { createTrack3D } from '../rendering3d/Track3D';
import { headingToYaw, toWorld } from '../rendering3d/WorldTransform';
import { resolveAiOccupancy } from '../simulation/AiOccupancyModel';
import { gridPositionFor, gridSlotForPosition, PLAYER_GRID } from '../simulation/GridModel';
import { stepSteering } from '../simulation/InputModel';
import { LapValidityTracker } from '../simulation/LapValidityModel';
import { lapTyreLabel, liveTimingTone } from '../simulation/LapRecordModel';
import {
  loadPlayerRacingLineCandidate,
  PlayerRacingLineCandidateRecorder,
  saveBestPlayerRacingLineCandidate,
} from '../simulation/PlayerRacingLineCandidate';
import {
  RaceRacingLineCandidateFilter,
  normalizedRaceCandidateSpeed,
} from '../simulation/RaceRacingLineCandidatePolicy';
import { activateStoredRacingLine } from '../simulation/RacingLineActivation';
import { activeReferenceTarget, runtimeRacingLine } from '../simulation/RacingLineRuntime';
import { selectedRacingLineSource } from '../simulation/RacingLineSelectionStore';
import { classifyLivePositions, type LiveStandingEntry } from '../simulation/LiveStandingsModel';
import {
  estimatedSignedGapSeconds,
  formatSignedRaceGap,
  RaceIntervalTracker,
} from '../simulation/RaceIntervalModel';
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
import { evaluateLaunch, launchTone, stepLaunchCharge } from '../simulation/RaceStartModel';
import { canRecover } from '../simulation/RecoveryModel';
import { twoCompoundWarning } from '../simulation/RuleFeedback';
import { selectStartingTyre } from '../simulation/StrategySelection';
import { surfaceEffect } from '../simulation/SurfaceModel';
import { createTire, stepTire, type Compound, type TireState } from '../simulation/TireModel';
import { formatTyreRaceStatus, tyreRaceStatus } from '../simulation/TyreRaceStatus';
import { minimumPositive, timingTone, type TimingTone } from '../simulation/TimingToneModel';
import { createVehicle, type VehicleState } from '../simulation/VehicleModel';
import { RapierRacePhysics } from '../simulation/RapierRacePhysics';
import {
  aeroEffect,
  createAiField,
  isTwoCompoundLegal,
  raceDistance,
  stepAiField,
  type DriverState,
  type RaceTrafficCar,
} from '../simulation/RaceModel';
import { completeLap, createTiming, formatLapTime, stepTiming, type TimingState } from '../simulation/TimingModel';
import { getActiveTrack, projectTrack, sampleTrack, TRACK_LENGTH } from '../simulation/TrackModel';
import type { RaceSetup } from './RaceSetup';

const FIXED_DT = 1 / 120;
const CAMERA_HALF_HEIGHT = 19.5;
const CAMERA_OFFSET = new THREE.Vector3(18.5, 34, 18.5);
const CORE_POWER_BOOST = 0.22;
const AI_COLORS = [0xe64c4c, 0xe8e8e5, 0x54cf88, 0x9f72e6, 0xf3a341, 0x5d8fe8, 0xf064ad];
const SECTOR_BOUNDARIES = [1 / 3, 2 / 3] as const;
const TIMING_EPSILON = 0.0005;

interface LapTelemetry {
  lap: number;
  compound: Compound;
  startCompound: Compound;
  endCompound: Compound;
  pitted: boolean;
  valid: boolean;
  s1: number;
  s2: number;
  s3: number;
  lapTime: number;
}

interface AiLapClock {
  lap: number;
  lapStartTime: number;
  bestLap?: number;
  lastLap?: number;
  lastProgress: number;
  nextSector: number;
  sectorStartTime: number;
}

export class CoreRaceGame {
  private readonly container: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly setup: RaceSetup;
  private readonly totalLaps: number;
  private readonly startCompound: Compound;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-40, 40, CAMERA_HALF_HEIGHT, -CAMERA_HALF_HEIGHT, 0.1, 460);
  private readonly keys = new Set<string>();
  private readonly playerCar: FormulaCar3D;
  private readonly aiCars: FormulaCar3D[];
  private readonly cameraTarget = new THREE.Vector3();
  private readonly physics: RapierRacePhysics;
  private readonly audio = new RaceAudio();
  private readonly raceIntervals = new RaceIntervalTracker();
  private readonly lapValidity = new LapValidityTracker();
  private readonly lineCandidate = new PlayerRacingLineCandidateRecorder();
  private readonly lineCandidateFilter = new RaceRacingLineCandidateFilter();
  private lastFrame = performance.now();
  private fixedAccumulator = 0;

  private ai: DriverState[];
  private vehicle: VehicleState;
  private tire: TireState;
  private timing: TimingState = createTiming();
  private flow: RaceFlowState = createRaceFlow();
  private pitStop: PitStopState = createPitStopState();
  private selectedCompound: Compound;
  private usedCompounds: Set<Compound>;
  private lap = 0;
  private trackProgress: number;
  private lastTrackProgress: number;
  private nextCheckpoint = 1;
  private pitRequested = false;
  private finishMessage = '';
  private steerInput = 0;
  private trackDistance = 0;
  private trafficPressure = 0;
  private nextSector = 1;
  private sectorStartTime = 0;
  private sectorTimes: number[] = [];
  private sectorTones: TimingTone[] = [];
  private lapHistory: LapTelemetry[] = [];
  private lapStartCompound: Compound;
  private lapPitted = false;
  private aiLapClocks = new Map<string, AiLapClock>();
  private sessionFastestLap?: number;
  private sessionFastestSectors: Array<number | undefined> = [undefined, undefined, undefined];
  private launchCharge = 0;
  private launchBoost = 0;
  private launchEffectRemaining = 0;
  private launchFeedback = '';
  private launchFeedbackTone: 'good' | 'bad' | 'neutral' = 'neutral';
  private lineCandidateReferenceGrip = 1;
  private racingLineNotice = '';
  private racingLineNoticeRemaining = 0;
  private debugEnabled = false;
  private debugAiIndex = 0;
  private debugGhost?: AiReferenceGhost;
  private debugGhostCar?: FormulaCar3D;
  private debugReferenceLine?: THREE.LineLoop;
  private debugActualTrail?: THREE.Line;
  private debugGhostTrail?: THREE.Line;
  private debugTargetMarker?: THREE.Mesh;
  private debugActualTrailPoints: THREE.Vector3[] = [];
  private debugGhostTrailPoints: THREE.Vector3[] = [];
  private debugLineRefreshRemaining = 0;

  constructor(container: HTMLElement, hud: HTMLElement, setup: RaceSetup) {
    this.container = container;
    this.hud = hud;
    this.setup = setup;
    this.totalLaps = Math.max(6, Math.min(30, Math.round(setup.totalLaps)));
    this.startCompound = setup.startCompound;
    this.ai = createAiField(setup.gridOrder);
    const playerGrid = this.playerGridSlot();
    this.trackProgress = playerGrid.progress;
    this.lastTrackProgress = playerGrid.progress;
    this.vehicle = this.startVehicle();

    const selection = selectStartingTyre(this.startCompound);
    this.tire = createTire(selection.startCompound);
    this.selectedCompound = selection.suggestedNextCompound;
    this.usedCompounds = new Set([selection.startCompound]);
    this.lapStartCompound = selection.startCompound;

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
    this.physics = new RapierRacePhysics(this.vehicle, this.ai);
    this.resetAiTiming();
    this.setupAiDebugVisuals();

    this.bindInput();
    this.resize();
    window.addEventListener('resize', this.resize);
    this.audio.unlock();
    this.syncVisuals(true);
    requestAnimationFrame(this.frame);
  }

  private setupWorld(): void {
    this.scene.background = new THREE.Color(0x8baab2);
    this.scene.fog = new THREE.Fog(0x8baab2, 165, 450);
    this.scene.add(new THREE.HemisphereLight(0xdceef3, 0x29402d, 1.45));

    const sun = new THREE.DirectionalLight(0xfff1d5, 3.2);
    sun.position.set(-58, 88, 38);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -120;
    sun.shadow.camera.right = 120;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 260;
    this.scene.add(sun);

    this.scene.add(createTrack3D());
    this.scene.add(createPitLane3D());
  }

  private bindInput(): void {
    window.addEventListener('keydown', (event) => {
      this.audio.unlock();
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      this.keys.add(event.code);
      if (event.repeat) return;
      if (event.code === 'KeyQ') this.chooseCompound('SOFT');
      if (event.code === 'KeyE') this.chooseCompound('MEDIUM');
      if (event.code === 'KeyR') this.chooseCompound('HARD');
      if (event.code === 'KeyF' && this.flow.phase === 'RACING' && !isPitActive(this.pitStop)) this.pitRequested = !this.pitRequested;
      if (event.code === 'KeyC') this.handleRecoveryOrRestart();
      if (event.code === 'F3') {
        event.preventDefault();
        this.toggleAiDebug();
      }
      if (event.code === 'F4' && this.debugEnabled) {
        event.preventDefault();
        this.cycleDebugAi();
      }
    });
    this.container.addEventListener('pointerdown', () => this.audio.unlock(), { passive: true });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private readonly resize = (): void => {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const aspect = width / height;
    this.renderer.setSize(width, height, false);
    this.camera.left = -CAMERA_HALF_HEIGHT * aspect;
    this.camera.right = CAMERA_HALF_HEIGHT * aspect;
    this.camera.top = CAMERA_HALF_HEIGHT;
    this.camera.bottom = -CAMERA_HALF_HEIGHT;
    this.camera.updateProjectionMatrix();
  };

  private readonly frame = (now: number): void => {
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    this.racingLineNoticeRemaining = Math.max(0, this.racingLineNoticeRemaining - dt);
    if (this.racingLineNoticeRemaining === 0) this.racingLineNotice = '';

    if (this.flow.phase !== 'FINISHED') {
      this.fixedAccumulator += dt;
      while (this.fixedAccumulator >= FIXED_DT) {
        this.stepSimulation(FIXED_DT);
        this.fixedAccumulator -= FIXED_DT;
      }
    }

    this.syncVisuals(false);
    this.syncAiDebugVisuals(dt);
    this.updateCamera(dt);
    this.updateAudio(dt);
    this.renderHud();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.frame);
  };

  private stepSimulation(dt: number): void {
    const previousPhase = this.flow.phase;
    if (previousPhase === 'COUNTDOWN') {
      this.launchCharge = stepLaunchCharge(this.launchCharge, this.keys.has('KeyW'), dt);
    }

    this.flow = stepRaceFlow(this.flow, dt);
    if (previousPhase === 'COUNTDOWN' && this.flow.phase === 'RACING') {
      const launch = evaluateLaunch(this.launchCharge);
      this.launchBoost = launch.powerBoost;
      this.launchEffectRemaining = 1.8;
      this.launchFeedback = launch.label;
      this.launchFeedbackTone = launchTone(launch.quality);
    }

    if (this.flow.phase !== 'RACING') {
      this.physics.stopPlayer();
      this.vehicle = this.physics.playerState();
      this.steerInput = 0;
      return;
    }

    if (this.launchEffectRemaining > 0) {
      this.launchEffectRemaining = Math.max(0, this.launchEffectRemaining - dt);
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
          performance: this.tire.grip,
          isPlayer: true,
        }];

    this.ai = stepAiField(this.ai, dt, this.totalLaps, playerTraffic, false);
    this.ai = resolveAiOccupancy(this.ai, dt);
    this.physics.syncAiKinematics(this.ai, dt, this.lap);
    this.stepAiDebugGhost(dt);

    if (this.stepPhysicalPit(dt)) {
      this.physics.step(dt);
      this.updateAiLapTiming();
      this.updateRaceIntervals();
      return;
    }

    const throttle = this.keys.has('KeyW') ? 1 : 0;
    const brake = this.keys.has('KeyS') ? 1 : 0;
    const rawSteer = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    this.steerInput = stepSteering(this.steerInput, rawSteer, this.vehicle.speed, dt);

    const beforeTrack = projectTrack(this.vehicle.x, this.vehicle.y);
    const surface = surfaceEffect(beforeTrack.distance);
    const aero = aeroEffect(this.lap, beforeTrack.progress, this.ai, beforeTrack.laneOffset);
    const speedLoad = Math.min(1, this.vehicle.speed / 112);
    const corneringLoad = Math.abs(this.steerInput) * speedLoad * 0.92;
    const brakingLoad = brake * speedLoad * 0.82;
    const battleLoad = this.trafficPressure * 0.2;
    const load = Math.min(1.34, corneringLoad + brakingLoad + throttle * 0.13 + surface.severity * 0.7 + battleLoad);

    this.tire = stepTire(this.tire, 'BALANCED', load + aero.dirtyAir * 0.5, dt);

    const launchPower = this.launchEffectRemaining > 0 ? this.launchBoost : 0;
    this.physics.drivePlayer({
      throttle,
      brake,
      steer: this.steerInput,
      tireGrip: this.tire.grip * (1 - aero.dirtyAir * 0.42),
      tireWear: this.tire.wear,
      surfaceGrip: surface.gripMultiplier,
      powerBoost: CORE_POWER_BOOST + aero.tow * 0.22 + launchPower,
      powerMultiplier: surface.powerMultiplier,
      rollingResistance: surface.rollingResistance,
    }, dt);
    this.physics.step(dt);
    this.vehicle = this.physics.playerState();
    this.updateAiLapTiming();

    const afterTrack = projectTrack(this.vehicle.x, this.vehicle.y);
    this.trackDistance = afterTrack.distance;
    this.lastTrackProgress = this.trackProgress;
    this.trackProgress = afterTrack.progress;
    if (this.lap >= 1) {
      const validityEvent = this.lapValidity.sample(
        afterTrack.laneOffset,
        afterTrack.heading,
        this.vehicle.heading,
      );
      if (validityEvent !== 'NONE') this.lineCandidate.markIneligible();

      this.lineCandidateFilter.sampleTraffic(
        dt,
        aero.tow,
        aero.dirtyAir,
        this.trafficPressure,
      );
      if (!this.lineCandidateFilter.eligible) this.lineCandidate.markIneligible();

      const normalizedSpeed = normalizedRaceCandidateSpeed(
        this.setup.trackId,
        afterTrack.progress,
        this.vehicle.speed,
        this.tire.grip,
        this.lineCandidateReferenceGrip,
      );
      const normalizedYawRate = this.vehicle.speed > 1
        ? this.vehicle.yawRate * normalizedSpeed / this.vehicle.speed
        : this.vehicle.yawRate;
      this.lineCandidate.sample(
        afterTrack.progress,
        afterTrack.laneOffset,
        normalizedSpeed,
        wrapAngle(this.vehicle.heading - afterTrack.heading),
        normalizedYawRate,
      );
    }
    this.updateSectorTiming();
    this.updateLapAndCheckpoints(afterTrack.distance);

    if (shouldEnterPit(this.lastTrackProgress, this.trackProgress, afterTrack.distance, this.pitRequested)) {
      this.lineCandidate.markIneligible();
      this.pitStop = beginPitStop();
      this.pitRequested = false;
      this.steerInput = 0;
    }

    this.trafficPressure = this.estimateTrafficPressure();
    this.updateRaceIntervals();
  }

  private stepPhysicalPit(dt: number): boolean {
    if (!isPitActive(this.pitStop)) return false;

    this.lineCandidate.markIneligible();
    const previous = this.pitStop;
    this.pitStop = stepPitStop(this.pitStop, dt);
    if (!previous.tyreChanged && this.pitStop.tyreChanged) {
      this.lapPitted = true;
      this.tire = createTire(this.selectedCompound);
      this.usedCompounds.add(this.selectedCompound);
      this.playerCar.setCompound(this.selectedCompound);
    }

    this.lastTrackProgress = this.trackProgress;
    const pose = pitLanePose(this.pitStop.t);
    this.trackProgress = pose.raceProgress;
    this.trackDistance = 0;
    this.updateSectorTiming();
    this.updateLapAndCheckpoints(0);
    this.steerInput = 0;
    this.trafficPressure = 0;

    const speed = this.pitStop.phase === 'SERVICE' ? 0 : PIT_SPEED;
    this.vehicle = { ...createVehicle(pose.x, pose.y, pose.heading), speed };
    this.physics.setPlayerState(this.vehicle);

    if (this.pitStop.phase === 'DONE') {
      const exit = pitLanePose(1);
      this.vehicle = { ...createVehicle(exit.x, exit.y, exit.heading), speed: PIT_SPEED };
      this.physics.setPlayerState(this.vehicle);
      this.pitStop = createPitStopState();
    }
    return true;
  }

  private updateSectorTiming(): void {
    if (this.lastTrackProgress > this.trackProgress) return;
    while (this.nextSector <= 2) {
      const threshold = SECTOR_BOUNDARIES[this.nextSector - 1];
      if (this.lastTrackProgress < threshold && this.trackProgress >= threshold) {
        const index = this.nextSector - 1;
        const sectorTime = this.timing.raceTime - this.sectorStartTime;
        this.sectorTimes.push(sectorTime);
        this.sectorTones.push(this.newSectorTone(index, sectorTime));
        if (!this.lapValidity.invalid) {
          this.registerSessionFastestSector(index, sectorTime);
        }
        this.sectorStartTime = this.timing.raceTime;
        this.nextSector += 1;
      } else break;
    }
  }

  private updateLapAndCheckpoints(distanceFromLine: number): void {
    if (distanceFromLine > 82) return;
    const crossedStart = this.lastTrackProgress > 0.88 && this.trackProgress < 0.12;

    if (this.lap === 0) {
      if (crossedStart) {
        this.lap = 1;
        this.nextCheckpoint = 1;
        this.sectorStartTime = this.timing.raceTime;
        this.lapStartCompound = this.tire.compound;
        this.lapPitted = false;
        this.lapValidity.reset();
        this.beginRaceLineCandidate();
        this.lineCandidate.markIneligible();
      }
      return;
    }

    const thresholds = [0, 0.24, 0.49, 0.74];
    if (this.nextCheckpoint <= 3 && this.trackProgress >= thresholds[this.nextCheckpoint]) this.nextCheckpoint += 1;
    if (!(this.nextCheckpoint === 4 && crossedStart)) return;

    const lapTime = this.timing.raceTime - this.timing.lapStartTime;
    const s1 = this.sectorTimes[0] ?? lapTime / 3;
    const s2 = this.sectorTimes[1] ?? lapTime / 3;
    const s3 = Math.max(0, lapTime - s1 - s2);
    this.sectorTones[2] = this.newSectorTone(2, s3);
    const validLap = !this.lapValidity.invalid;
    if (validLap) {
      [s1, s2, s3].forEach((sectorTime, index) => {
        this.registerSessionFastestSector(index, sectorTime);
      });
    }
    this.lapHistory.push({
      lap: this.lap,
      compound: this.tire.compound,
      startCompound: this.lapStartCompound,
      endCompound: this.tire.compound,
      pitted: this.lapPitted,
      valid: validLap,
      s1,
      s2,
      s3,
      lapTime,
    });
    this.lapHistory = this.lapHistory.slice(-this.totalLaps);
    if (validLap && this.lap >= 2 && lapTime > 10) this.registerSessionFastest(lapTime);
    this.commitRaceLineCandidate(lapTime, validLap);

    this.timing = completeLap(this.timing, validLap);
    this.lap += 1;
    this.nextCheckpoint = 1;
    this.nextSector = 1;
    this.sectorStartTime = this.timing.raceTime;
    this.sectorTimes = [];
    this.sectorTones = [];
    this.lapStartCompound = this.tire.compound;
    this.lapPitted = false;
    this.lapValidity.reset();
    this.beginRaceLineCandidate();

    if (this.lap > this.totalLaps) {
      const legal = isTwoCompoundLegal(this.usedCompounds);
      const standings = this.standings();
      const position = standings.findIndex((driver) => driver.id === 'player') + 1;
      this.flow = finishRaceFlow(this.flow);
      this.finishMessage = legal ? `P${position} · FINISH` : `P${position} · DISQUALIFIED`;
      this.physics.stopPlayer();
      this.vehicle = this.physics.playerState();
    }
  }

  private beginRaceLineCandidate(): void {
    this.lineCandidateReferenceGrip = this.tire.grip;
    this.lineCandidate.begin(this.setup.trackId, this.lineCandidateReferenceGrip);
    this.lineCandidateFilter.reset();
  }

  private commitRaceLineCandidate(lapTime: number, validLap: boolean): void {
    const eligibility = this.lapValidity.snapshot();
    if (
      !validLap
      || this.lap < 2
      || this.lapPitted
      || !eligibility.candidateEligible
      || !this.lineCandidateFilter.eligible
    ) {
      return;
    }

    const candidate = this.lineCandidate.finish(lapTime);
    if (!candidate) return;

    const previous = loadPlayerRacingLineCandidate(
      window.localStorage,
      this.setup.trackId,
    );
    const previousSeconds = previous?.lapSeconds;
    const previousHasDynamics = previous?.points.some(
      (point) => point.headingOffset !== undefined && point.yawRate !== undefined,
    ) ?? false;
    const saved = saveBestPlayerRacingLineCandidate(
      window.localStorage,
      candidate,
    );
    const savedHasDynamics = saved.points.some(
      (point) => point.headingOffset !== undefined && point.yawRate !== undefined,
    );
    const dynamicsUpgrade = previous !== undefined
      && !previousHasDynamics
      && savedHasDynamics;
    const improved = previousSeconds === undefined
      || (saved.lapSeconds !== undefined && saved.lapSeconds < previousSeconds - 0.0005);
    if (!improved && !dynamicsUpgrade) return;

    const usingPlayerLine = selectedRacingLineSource(
      window.localStorage,
      this.setup.trackId,
    ) === 'PLAYER';
    if (usingPlayerLine) {
      activateStoredRacingLine(window.localStorage, this.setup.trackId);
    }

    this.racingLineNotice = dynamicsUpgrade
      ? usingPlayerLine
        ? `CPU LINE UPGRADED · HEADING + YAW`
        : `PLAYER LINE UPGRADED · HEADING + YAW`
      : usingPlayerLine
        ? `CPU LINE UPDATED · ${lapTime.toFixed(3)}s`
        : `PLAYER LINE SAVED · ${lapTime.toFixed(3)}s`;
    this.racingLineNoticeRemaining = 3.2;

    console.info('RACING_LINE_CANDIDATE', {
      trackId: saved.trackId,
      source: saved.source,
      lapSeconds: saved.lapSeconds,
      points: saved.points.length,
      raceLap: this.lap,
      trafficAffectedSeconds: this.lineCandidateFilter.affectedSeconds,
      activatedForCpu: usingPlayerLine,
      dynamicsUpgrade,
      demonstratedDynamics: savedHasDynamics,
    });
  }

  private updateAiLapTiming(): void {
    for (const driver of this.ai) {
      const clock = this.aiLapClocks.get(driver.id);
      if (!clock) {
        this.aiLapClocks.set(driver.id, this.createAiClock(driver));
        continue;
      }

      if (driver.lap > clock.lap) {
        if (clock.lap >= 1) {
          const s3 = this.timing.raceTime - clock.sectorStartTime;
          if (s3 > 0.5) this.registerSessionFastestSector(2, s3);
        }
        const completedLap = this.timing.raceTime - clock.lapStartTime;
        if (clock.lap >= 1 && completedLap > 10) clock.lastLap = completedLap;
        if (clock.lap >= 2 && completedLap > 10) {
          clock.bestLap = clock.bestLap === undefined ? completedLap : Math.min(clock.bestLap, completedLap);
          this.registerSessionFastest(completedLap);
        }
        clock.lap = driver.lap;
        clock.lapStartTime = this.timing.raceTime;
        clock.lastProgress = driver.progress;
        clock.nextSector = 1;
        clock.sectorStartTime = this.timing.raceTime;
        continue;
      }

      if (driver.lap >= 1 && clock.nextSector <= 2) {
        const threshold = SECTOR_BOUNDARIES[clock.nextSector - 1];
        if (clock.lastProgress < threshold && driver.progress >= threshold) {
          const sectorTime = this.timing.raceTime - clock.sectorStartTime;
          if (sectorTime > 0.5) this.registerSessionFastestSector(clock.nextSector - 1, sectorTime);
          clock.sectorStartTime = this.timing.raceTime;
          clock.nextSector += 1;
        }
      }
      clock.lastProgress = driver.progress;
    }
  }

  private updateRaceIntervals(): void {
    this.raceIntervals.update([
      { id: 'player', lap: this.lap, progress: this.trackProgress },
      ...this.ai.map((driver) => ({ id: driver.id, lap: driver.lap, progress: driver.progress })),
    ], this.timing.raceTime);
  }

  private registerSessionFastest(lapTime: number): void {
    this.sessionFastestLap = this.sessionFastestLap === undefined ? lapTime : Math.min(this.sessionFastestLap, lapTime);
  }

  private registerSessionFastestSector(index: number, sectorTime: number): void {
    const previous = this.sessionFastestSectors[index];
    this.sessionFastestSectors[index] = previous === undefined ? sectorTime : Math.min(previous, sectorTime);
  }

  private newSectorTone(index: number, sectorTime: number): TimingTone {
    const personalBest = this.playerBestSector((['s1', 's2', 's3'] as const)[index]);
    const sessionBest = this.sessionFastestSectors[index];
    if (sessionBest === undefined || sectorTime < sessionBest - TIMING_EPSILON) return 'session-best';
    if (personalBest === undefined || sectorTime < personalBest - TIMING_EPSILON) return 'personal-best';
    return 'neutral';
  }

  private createAiClock(driver: DriverState): AiLapClock {
    return {
      lap: driver.lap,
      lapStartTime: this.timing.raceTime,
      lastProgress: driver.progress,
      nextSector: 1,
      sectorStartTime: this.timing.raceTime,
    };
  }

  private resetAiTiming(): void {
    this.aiLapClocks = new Map(this.ai.map((driver) => [driver.id, this.createAiClock(driver)]));
  }

  private estimateTrafficPressure(): number {
    const playerDistance = raceDistance(this.lap, this.trackProgress) * TRACK_LENGTH;
    let pressure = 0;
    const playerLane = projectTrack(this.vehicle.x, this.vehicle.y).laneOffset;
    for (const driver of this.ai) {
      if (driver.finished) continue;
      const aiDistance = raceDistance(driver.lap, driver.progress) * TRACK_LENGTH;
      const longitudinal = Math.abs(aiDistance - playerDistance);
      const lateral = Math.abs(driver.laneOffset - playerLane);
      if (longitudinal > 72 || lateral > 34) continue;
      pressure = Math.max(pressure, (1 - longitudinal / 72) * (1 - lateral / 34));
    }
    return pressure;
  }

  private syncVisuals(initial: boolean): void {
    const playerPos = toWorld(this.vehicle.x, this.vehicle.y, 0.08);
    this.playerCar.root.position.copy(playerPos);
    this.playerCar.root.rotation.y = headingToYaw(this.vehicle.heading);
    this.playerCar.root.rotation.z = -this.steerInput * Math.min(0.045, this.vehicle.speed / 2300);

    const aiStates = this.physics.aiStates();
    this.ai.forEach((driver, index) => {
      const state = aiStates[index];
      if (!state) return;
      const world = toWorld(state.x, state.y, 0.08);
      const car = this.aiCars[index];
      car.root.position.copy(world);
      car.root.rotation.y = headingToYaw(state.heading);
      car.root.rotation.z = driver.battleState === 'ATTACK' ? 0.018 : driver.battleState === 'DEFEND' ? -0.012 : driver.battleState === 'SIDE_BY_SIDE' ? 0.009 : 0;
      car.setCompound(driver.tire.compound);
    });

    if (initial) {
      this.cameraTarget.copy(playerPos);
      this.camera.position.copy(playerPos).add(CAMERA_OFFSET);
      this.camera.lookAt(this.cameraTarget);
    }
  }

  private setupAiDebugVisuals(): void {
    this.debugReferenceLine = new THREE.LineLoop(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x48ff74,
        transparent: true,
        opacity: 0.92,
        depthTest: false,
      }),
    );
    this.debugReferenceLine.renderOrder = 40;
    this.debugReferenceLine.visible = false;
    this.scene.add(this.debugReferenceLine);

    this.debugActualTrail = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0xff4d5f,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
      }),
    );
    this.debugActualTrail.renderOrder = 41;
    this.debugActualTrail.visible = false;
    this.scene.add(this.debugActualTrail);

    this.debugGhostTrail = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x39dfff,
        transparent: true,
        opacity: 0.86,
        depthTest: false,
      }),
    );
    this.debugGhostTrail.renderOrder = 41;
    this.debugGhostTrail.visible = false;
    this.scene.add(this.debugGhostTrail);

    this.debugTargetMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.72, 12, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffe55c,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
      }),
    );
    this.debugTargetMarker.renderOrder = 42;
    this.debugTargetMarker.visible = false;
    this.scene.add(this.debugTargetMarker);

    this.debugGhostCar = createFormulaCar(0x35dff4, 'SOFT');
    this.debugGhostCar.root.visible = false;
    this.debugGhostCar.root.renderOrder = 43;
    this.debugGhostCar.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        material.transparent = true;
        material.opacity = 0.42;
        material.depthWrite = false;
      }
      object.castShadow = false;
      object.receiveShadow = false;
    });
    this.scene.add(this.debugGhostCar.root);
  }

  private toggleAiDebug(): void {
    this.debugEnabled = !this.debugEnabled;
    if (!this.debugEnabled) {
      this.setAiDebugVisualsVisible(false);
      this.debugGhost = undefined;
      return;
    }

    this.debugAiIndex = Math.min(this.debugAiIndex, Math.max(0, this.ai.length - 1));
    this.clearAiDebugTrails();
    this.resetAiDebugGhost();
    this.refreshAiDebugReferenceLine();
    this.setAiDebugVisualsVisible(true);
  }

  private cycleDebugAi(): void {
    if (this.ai.length === 0) return;
    this.debugAiIndex = (this.debugAiIndex + 1) % this.ai.length;
    this.clearAiDebugTrails();
    this.resetAiDebugGhost();
    this.refreshAiDebugReferenceLine();
  }

  private setAiDebugVisualsVisible(visible: boolean): void {
    if (this.debugReferenceLine) this.debugReferenceLine.visible = visible;
    if (this.debugActualTrail) this.debugActualTrail.visible = visible;
    if (this.debugGhostTrail) this.debugGhostTrail.visible = visible;
    if (this.debugTargetMarker) this.debugTargetMarker.visible = visible;
    if (this.debugGhostCar) this.debugGhostCar.root.visible = visible;
  }

  private clearAiDebugTrails(): void {
    this.debugActualTrailPoints = [];
    this.debugGhostTrailPoints = [];
    this.debugActualTrail?.geometry.setFromPoints([]);
    this.debugGhostTrail?.geometry.setFromPoints([]);
  }

  private resetAiDebugGhost(): void {
    const selected = this.ai[this.debugAiIndex];
    const startProgress = selected?.progress ?? this.trackProgress;
    this.debugGhost = new AiReferenceGhost(startProgress, this.setup.trackId);
    this.debugLineRefreshRemaining = 0;
  }

  private refreshAiDebugReferenceLine(): void {
    if (!this.debugReferenceLine) return;
    const grip = this.ai[this.debugAiIndex]?.tire.grip ?? this.tire.grip;
    const points = Array.from({ length: 240 }, (_, index) => {
      const progress = index / 240;
      const reference = activeReferenceTarget(this.setup.trackId, progress, grip);
      const track = sampleTrack(progress, reference.laneOffset);
      return toWorld(track.x, track.y, 0.17);
    });
    this.debugReferenceLine.geometry.setFromPoints(points);
    this.debugLineRefreshRemaining = 0.5;
  }

  private stepAiDebugGhost(dt: number): void {
    if (!this.debugEnabled || !this.debugGhost) return;
    this.debugGhost.step(dt);
  }

  private syncAiDebugVisuals(dt: number): void {
    if (!this.debugEnabled) return;

    this.debugLineRefreshRemaining -= dt;
    if (this.debugLineRefreshRemaining <= 0) this.refreshAiDebugReferenceLine();

    const state = this.physics.aiStates()[this.debugAiIndex];
    const control = this.physics.aiControls()[this.debugAiIndex];
    if (state) this.appendAiDebugTrail(this.debugActualTrailPoints, this.debugActualTrail, state);

    if (control && this.debugTargetMarker) {
      const target = sampleTrack(control.debug.steeringProgress, control.targetLane);
      this.debugTargetMarker.position.copy(toWorld(target.x, target.y, 0.28));
    }

    const ghostState = this.debugGhost?.state();
    if (ghostState && this.debugGhostCar) {
      this.debugGhostCar.root.position.copy(toWorld(ghostState.x, ghostState.y, 0.11));
      this.debugGhostCar.root.rotation.y = headingToYaw(ghostState.heading);
      this.appendAiDebugTrail(this.debugGhostTrailPoints, this.debugGhostTrail, ghostState);
    }
  }

  private appendAiDebugTrail(
    points: THREE.Vector3[],
    line: THREE.Line | undefined,
    state: VehicleState,
  ): void {
    if (!line) return;
    const next = toWorld(state.x, state.y, 0.20);
    const previous = points[points.length - 1];
    if (previous && previous.distanceToSquared(next) < 0.18 * 0.18) return;
    points.push(next);
    if (points.length > 420) points.splice(0, points.length - 420);
    line.geometry.setFromPoints(points);
  }

  private updateCamera(dt: number): void {
    const position = toWorld(this.vehicle.x, this.vehicle.y, 0.25);
    const desired = position.clone().add(CAMERA_OFFSET);
    const cameraLerp = 1 - Math.exp(-dt * 4.0);
    const targetLerp = 1 - Math.exp(-dt * 4.4);
    this.cameraTarget.lerp(position, targetLerp);
    this.camera.position.lerp(desired, cameraLerp);
    this.camera.lookAt(this.cameraTarget);
  }

  private updateAudio(dt: number): void {
    const surface = surfaceEffect(this.trackDistance);
    this.audio.update({
      speed: this.vehicle.speed,
      throttle: this.flow.phase === 'RACING' && this.keys.has('KeyW') && !isPitActive(this.pitStop) ? 1 : 0,
      brake: this.flow.phase === 'RACING' && this.keys.has('KeyS') && !isPitActive(this.pitStop) ? 1 : 0,
      steer: this.steerInput,
      tireGrip: this.tire.grip,
      slideSeverity: this.physics.playerSlideSeverity(),
      surfaceSeverity: surface.severity,
      trafficPressure: this.trafficPressure,
      pitService: this.pitStop.phase === 'SERVICE',
      banner: raceBanner(this.flow),
    }, dt);
  }

  private chooseCompound(compound: Compound): void {
    if (this.flow.phase !== 'FINISHED' && !isPitActive(this.pitStop)) this.selectedCompound = compound;
  }

  private handleRecoveryOrRestart(): void {
    if (this.flow.phase === 'FINISHED') {
      this.resetRace();
      return;
    }
    if (isPitActive(this.pitStop)) return;
    if (this.flow.phase !== 'RACING' || !canRecover(this.trackDistance, this.vehicle.speed)) return;
    if (this.lap >= 1) {
      this.lapValidity.invalidate();
      this.lineCandidate.markIneligible();
    }
    const p = sampleTrack(this.trackProgress);
    this.vehicle = createVehicle(p.x, p.y, p.heading);
    this.physics.setPlayerState(this.vehicle);
    this.steerInput = 0;
    this.trackDistance = 0;
  }

  private resetRace(): void {
    this.ai = createAiField(this.setup.gridOrder);
    this.vehicle = this.startVehicle();
    const selection = selectStartingTyre(this.startCompound);
    this.tire = createTire(selection.startCompound);
    this.timing = createTiming();
    this.flow = createRaceFlow();
    this.pitStop = createPitStopState();
    this.selectedCompound = selection.suggestedNextCompound;
    this.usedCompounds = new Set([selection.startCompound]);
    this.lap = 0;
    const playerGrid = this.playerGridSlot();
    this.trackProgress = playerGrid.progress;
    this.lastTrackProgress = playerGrid.progress;
    this.nextCheckpoint = 1;
    this.pitRequested = false;
    this.finishMessage = '';
    this.steerInput = 0;
    this.trackDistance = 0;
    this.trafficPressure = 0;
    this.nextSector = 1;
    this.sectorStartTime = 0;
    this.sectorTimes = [];
    this.sectorTones = [];
    this.lapHistory = [];
    this.lapStartCompound = selection.startCompound;
    this.lapPitted = false;
    this.lapValidity.reset();
    this.lineCandidateFilter.reset();
    this.lineCandidateReferenceGrip = this.tire.grip;
    this.racingLineNotice = '';
    this.racingLineNoticeRemaining = 0;
    this.sessionFastestLap = undefined;
    this.sessionFastestSectors = [undefined, undefined, undefined];
    this.fixedAccumulator = 0;
    this.launchCharge = 0;
    this.launchBoost = 0;
    this.launchEffectRemaining = 0;
    this.launchFeedback = '';
    this.launchFeedbackTone = 'neutral';
    this.raceIntervals.reset();
    this.physics.reset(this.vehicle, this.ai);
    this.resetAiTiming();
    if (this.debugEnabled) {
      this.clearAiDebugTrails();
      this.resetAiDebugGhost();
      this.refreshAiDebugReferenceLine();
    }
    this.audio.reset();
    this.playerCar.setCompound(this.startCompound);
    this.syncVisuals(true);
  }

  private playerGridSlot() {
    const position = gridPositionFor('player', this.setup.gridOrder);
    return position === undefined ? PLAYER_GRID : gridSlotForPosition(position);
  }

  private startVehicle(): VehicleState {
    const grid = this.playerGridSlot();
    const start = sampleTrack(grid.progress, grid.laneOffset);
    return createVehicle(start.x, start.y, start.heading);
  }

  private standings(): LiveStandingEntry[] {
    const aiStates = this.physics.aiStates();
    return classifyLivePositions([
      { id: 'player', name: 'YOU', lap: this.lap, vehicle: this.vehicle },
      ...this.ai.map((driver, index) => ({ id: driver.id, name: driver.name, lap: driver.lap, vehicle: aiStates[index] ?? sampleTrack(driver.progress) })),
    ]);
  }

  private compoundFor(id: string): Compound {
    if (id === 'player') return this.tire.compound;
    return this.ai.find((driver) => driver.id === id)?.tire.compound ?? 'MEDIUM';
  }

  private lastLapFor(id: string): number | undefined {
    if (id === 'player') return this.timing.lastLapTime;
    return this.aiLapClocks.get(id)?.lastLap;
  }

  private miniMapSvg(): string {
    const samples = Array.from({ length: 100 }, (_, i) => sampleTrack(i / 100));
    const minX = Math.min(...samples.map((p) => p.x));
    const maxX = Math.max(...samples.map((p) => p.x));
    const minY = Math.min(...samples.map((p) => p.y));
    const maxY = Math.max(...samples.map((p) => p.y));
    const width = 330;
    const height = 160;
    const pad = 10;
    const scale = Math.min((width - pad * 2) / Math.max(1, maxX - minX), (height - pad * 2) / Math.max(1, maxY - minY));
    const ox = (width - (maxX - minX) * scale) / 2;
    const oy = (height - (maxY - minY) * scale) / 2;
    const point = (progress: number) => {
      const p = sampleTrack(progress);
      return { x: ox + (p.x - minX) * scale, y: oy + (p.y - minY) * scale };
    };
    const path = samples.map((p, index) => `${index === 0 ? 'M' : 'L'}${(ox + (p.x - minX) * scale).toFixed(1)},${(oy + (p.y - minY) * scale).toFixed(1)}`).join(' ') + ' Z';
    const aiStates = this.physics.aiStates();
    const aiDots = this.ai.map((driver, index) => {
      const state = aiStates[index];
      const progress = state ? projectTrack(state.x, state.y).progress : driver.progress;
      const p = point(progress);
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.2" fill="#${(AI_COLORS[index] ?? 0xffffff).toString(16).padStart(6, '0')}" stroke="#071014" stroke-width="1.2"/>`;
    }).join('');
    const player = point(projectTrack(this.vehicle.x, this.vehicle.y).progress);
    return `<svg viewBox="0 0 ${width} ${height}" aria-label="live circuit map"><path d="${path}" fill="none" stroke="rgba(238,243,239,.48)" stroke-width="2.8"/>${aiDots}<circle cx="${player.x.toFixed(1)}" cy="${player.y.toFixed(1)}" r="5.8" fill="#31b9ef" stroke="#ffffff" stroke-width="1.8"/></svg>`;
  }

  private playerBestLap(): number | undefined {
    return minimumPositive(
      this.lapHistory.filter((row) => row.valid).map((row) => row.lapTime),
    );
  }

  private playerBestSector(key: 's1' | 's2' | 's3'): number | undefined {
    return minimumPositive(
      this.lapHistory.filter((row) => row.valid).map((row) => row[key]),
    );
  }

  private timingClass(tone: TimingTone): string {
    return tone === 'session-best' ? 'timing-purple' : tone === 'personal-best' ? 'timing-green' : '';
  }

  private renderLapBoard(): string {
    const rows = [...this.lapHistory];
    const displayLap = Math.max(1, this.lap);
    if (this.flow.phase !== 'FINISHED' && this.lap <= this.totalLaps) {
      const elapsed = this.timing.currentLapTime;
      const s1 = this.sectorTimes[0];
      const s2 = this.sectorTimes[1];
      const currentSectorElapsed = Math.max(0, this.timing.raceTime - this.sectorStartTime);
      rows.push({
        lap: displayLap,
        compound: this.tire.compound,
        startCompound: this.lapStartCompound,
        endCompound: this.tire.compound,
        pitted: this.lapPitted,
        valid: !this.lapValidity.invalid,
        s1: s1 ?? (this.nextSector === 1 ? currentSectorElapsed : 0),
        s2: s2 ?? (this.nextSector === 2 ? currentSectorElapsed : 0),
        s3: this.nextSector === 3 ? currentSectorElapsed : 0,
        lapTime: elapsed,
      });
    }

    const personalBest = this.playerBestLap();
    const historicalBestSectors = [
      this.playerBestSector('s1'),
      this.playerBestSector('s2'),
      this.playerBestSector('s3'),
    ];
    const bestSectors = historicalBestSectors.map((best, index) => {
      const live = this.sectorTimes[index];
      if (live === undefined) return best;
      return best === undefined ? live : Math.min(best, live);
    });
    return rows.slice(-10).map((row) => {
      const current = row.lap === displayLap && this.flow.phase !== 'FINISHED';
      const completed = !current;
      const lapTone = completed && row.valid
        ? timingTone(row.lapTime, personalBest, this.sessionFastestLap)
        : 'neutral';
      const sectorValues = [row.s1, row.s2, row.s3];
      const sectorCell = (index: number) => {
        const value = sectorValues[index];
        const liveSectorCompleted = index < this.sectorTimes.length;
        const tone = current && value > 0
          ? liveTimingTone(value, bestSectors[index], this.sessionFastestSectors[index], liveSectorCompleted)
          : completed && row.valid
            ? timingTone(value, bestSectors[index], this.sessionFastestSectors[index])
            : 'neutral';
        return `<span class="${this.timingClass(tone)}">${value > 0 ? formatShortTime(value) : '—'}</span>`;
      };
      const tyreLabel = lapTyreLabel(row.startCompound, row.endCompound, row.pitted);
      const tyreStyle = tyreLabel.length > 1 ? 'font-size:10px;padding:2px 1px;white-space:nowrap' : '';
      return `<div class="lap-row ${current ? 'current' : ''}" style="grid-template-columns:34px 58px 72px 72px 72px 1fr"><b>${row.lap}</b><i class="compound-pill tyre-${row.endCompound.toLowerCase()}" style="${tyreStyle}">${tyreLabel}</i>${sectorCell(0)}${sectorCell(1)}${sectorCell(2)}<strong class="${this.timingClass(lapTone)}">${completed && !row.valid ? 'INVALID' : row.lapTime > 0 ? formatLapTime(row.lapTime) : '—'}</strong></div>`;
    }).join('');
  }

  private renderAiDebugPanel(): string {
    if (!this.debugEnabled) return '';

    const driver = this.ai[this.debugAiIndex];
    const state = this.physics.aiStates()[this.debugAiIndex];
    const control = this.physics.aiControls()[this.debugAiIndex];
    const line = runtimeRacingLine(this.setup.trackId);
    const ghostControl = this.debugGhost?.latestControl();
    const ghostState = this.debugGhost?.state();
    const source = control?.debug.lineSource ?? line?.source ?? 'AUTO';
    const fixed = (value: number | undefined, digits = 2): string =>
      value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);
    const percent = (value: number | undefined): string =>
      value === undefined || !Number.isFinite(value) ? '—' : `${Math.round(value * 100)}%`;
    const degreesPerSecond = (value: number | undefined): string =>
      value === undefined || !Number.isFinite(value)
        ? '—'
        : `${(value * 180 / Math.PI).toFixed(0)}°/s`;
    const degrees = (value: number | undefined): string =>
      value === undefined || !Number.isFinite(value)
        ? '—'
        : `${(value * 180 / Math.PI).toFixed(1)}°`;
    const lap = line?.lapSeconds === undefined ? '—' : `${line.lapSeconds.toFixed(3)}s`;
    const ghostLap = this.debugGhost?.lastLapSeconds();
    const ghostCurrent = this.debugGhost?.currentLapSeconds();
    const ghostTime = ghostLap !== undefined
      ? `${ghostLap.toFixed(3)}s LAST`
      : ghostCurrent !== undefined
        ? `${ghostCurrent.toFixed(3)}s LIVE`
        : 'ARMING';

    return `<div style="position:absolute;right:14px;top:88px;width:310px;padding:12px 14px;background:rgba(3,10,12,.92);border:1px solid rgba(72,255,116,.5);box-shadow:0 8px 28px rgba(0,0,0,.35);font:12px/1.42 ui-monospace,SFMono-Regular,Consolas,monospace;color:#dce9e4;z-index:30">
      <div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:8px"><b style="color:#48ff74;letter-spacing:.08em">AI LINE DEBUG</b><span>F3 OFF · F4 NEXT</span></div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:3px 12px">
        <span>AI</span><b>${driver?.name ?? '—'} [${this.debugAiIndex + 1}/${this.ai.length}]</b>
        <span>LINE SOURCE</span><b style="color:#48ff74">${source}</b>
        <span>LINE LAP</span><b>${lap}</b>
        <span>STATE TRACE</span><b style="color:${control?.debug.demonstratedDynamics ? '#48ff74' : '#ffc94d'}">${control?.debug.demonstratedDynamics ? 'HEADING + YAW' : 'LEGACY · RECORD CLEAN LAP'}</b>
        <span>MODE</span><b>${control?.battleState ?? '—'}</b>
        <span>LANE actual / ref</span><b>${fixed(driver?.laneOffset)} / ${fixed(control?.debug.referenceLane)}</b>
        <span>LANE ERROR</span><b style="color:${Math.abs(control?.debug.laneError ?? 0) > 2 ? '#ff6978' : '#dce9e4'}">${fixed(control?.debug.laneError)} m</b>
        <span>SPEED actual / target</span><b>${fixed(state ? state.speed * 3.6 : undefined, 0)} / ${fixed(control ? control.targetSpeed * 3.6 : undefined, 0)} km/h</b>
        <span>STEER / THROTTLE</span><b>${fixed(control?.steer)} / ${fixed(control?.throttle)}</b>
        <span>YAW actual / target</span><b>${degreesPerSecond(state?.yawRate)} / ${degreesPerSecond(control?.debug.targetYawRate)}</b>
        <span>HEADING / BEARING err</span><b>${degrees(control?.debug.pathHeadingError)} / ${degrees(control?.debug.bearingError)}</b>
        <span>BRAKE final</span><b>${fixed(control?.brake)}</b>
        <span>BRAKE feedback / profile</span><b>${fixed(control?.debug.feedbackBrake)} / ${fixed(control?.debug.profileBrake)}</b>
        <span>THROTTLE profile</span><b>${fixed(control?.debug.profileThrottle)}</b>
        <span>LOOKAHEAD</span><b>${fixed(control?.debug.lookAheadMetres, 1)} m</b>
        <span>PREDICT</span><b>${percent(control?.debug.predictionWeight)}</b>
      </div>
      <div style="height:1px;background:rgba(255,255,255,.12);margin:9px 0"></div>
      <div style="display:flex;justify-content:space-between"><b style="color:#39dfff">REFERENCE GHOST</b><span>TRAFFIC OFF · 100%</span></div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:3px 12px;margin-top:5px">
        <span>LAP</span><b>${ghostTime}</b>
        <span>LANE ERROR</span><b>${fixed(ghostControl?.debug.laneError)} m</b>
        <span>SPEED actual / target</span><b>${fixed(ghostState ? ghostState.speed * 3.6 : undefined, 0)} / ${fixed(ghostControl ? ghostControl.targetSpeed * 3.6 : undefined, 0)} km/h</b>
        <span>STATE TRACE</span><b>${ghostControl?.debug.demonstratedDynamics ? 'HEADING + YAW' : 'LEGACY · UPGRADE NEEDED'}</b>
        <span>YAW actual / target</span><b>${degreesPerSecond(ghostState?.yawRate)} / ${degreesPerSecond(ghostControl?.debug.targetYawRate)}</b>
        <span>HEADING err</span><b>${degrees(ghostControl?.debug.pathHeadingError)}</b>
        <span>BRAKE</span><b>${fixed(ghostControl?.brake)}</b>
        <span>THROTTLE profile</span><b>${fixed(ghostControl?.debug.profileThrottle)}</b>
      </div>
      <div style="margin-top:9px;color:#96a8a1">GREEN line = effective reference · RED = selected CPU · CYAN = isolated ghost · YELLOW = CPU steering target</div>
    </div>`;
  }

  private renderHud(): void {
    const standings = this.standings();
    const playerIndex = standings.findIndex((driver) => driver.id === 'player');
    const position = playerIndex + 1;
    const playerStanding = standings[playerIndex];
    const surface = surfaceEffect(this.trackDistance);
    const projection = projectTrack(this.vehicle.x, this.vehicle.y);
    const aero = aeroEffect(this.lap, projection.progress, this.ai, projection.laneOffset);
    const banner = raceBanner(this.flow);
    const legal = isTwoCompoundLegal(this.usedCompounds);
    const displayLap = Math.max(1, Math.min(this.lap, this.totalLaps));
    const obligation = this.flow.phase === 'RACING'
      ? twoCompoundWarning(this.usedCompounds, this.tire.compound, this.selectedCompound, displayLap, this.totalLaps, this.pitRequested || isPitActive(this.pitStop))
      : undefined;
    const recovery = this.flow.phase === 'RACING' && !isPitActive(this.pitStop) && canRecover(this.trackDistance, this.vehicle.speed);
    const speed = Math.round(this.vehicle.speed * 3.6);
    const wearPct = Math.round(this.tire.wear * 100);
    const tyreStatus = tyreRaceStatus(this.tire);
    const tyreStatusText = formatTyreRaceStatus(tyreStatus);
    const tyreStatusClass = tyreStatus.condition === 'CLIFF RISK' ? 'cliff' : tyreStatus.condition === 'USED' ? 'used' : 'optimal';
    const compoundHistory = [...this.usedCompounds].join(' → ');
    const delta = this.timing.deltaToBest === undefined ? '—' : `${this.timing.deltaToBest >= 0 ? '+' : ''}${this.timing.deltaToBest.toFixed(3)}`;
    const gridPosition = gridPositionFor('player', this.setup.gridOrder) ?? 8;
    const pitLabel = this.flow.phase === 'COUNTDOWN'
      ? `START ${this.tire.compound} · GRID P${gridPosition}`
      : this.pitStop.phase === 'SERVICE'
        ? `PIT BOX · ${this.pitStop.serviceRemaining.toFixed(1)}s`
        : isPitActive(this.pitStop)
          ? `PIT LANE · ${this.pitStop.phase === 'TRANSIT_IN' ? 'IN' : 'OUT'}`
          : this.pitRequested
            ? `BOX THIS LAP → ${this.selectedCompound}`
            : `NEXT ${this.selectedCompound} · F TO BOX`;
    const slideSeverity = this.physics.playerSlideSeverity();
    const validity = this.lapValidity.snapshot();
    const raceState = validity.invalid
      ? 'LAP INVALID · TRACK LIMITS'
      : validity.warnings > 0
        ? `TRACK LIMITS ${validity.warnings}/3`
        : slideSeverity > 0.15
          ? 'REAR SLIDE'
      : surface.label !== 'TRACK'
        ? surface.label
        : this.trafficPressure > 0.18 && aero.dirtyAir < 0.025
          ? 'SIDE BY SIDE · CLEAN AIR'
          : aero.dirtyAir > 0.01
            ? `DIRTY AIR ${(aero.dirtyAir * 100).toFixed(0)}%`
            : aero.tow > 0.01
              ? `TOW ${(aero.tow * 100).toFixed(0)}% · CLEAN AIR`
              : 'CLEAN AIR';

    const currentSector = Math.min(3, this.nextSector);
    const currentSectorElapsed = Math.max(0, this.timing.raceTime - this.sectorStartTime);
    const sectorDisplay = [1, 2, 3].map((sector) => {
      const completed = this.sectorTimes[sector - 1];
      if (completed !== undefined) {
        const best = this.playerBestSector((['s1', 's2', 's3'] as const)[sector - 1]);
        return {
          text: formatShortTime(completed),
          tone: liveTimingTone(completed, best, this.sessionFastestSectors[sector - 1]),
        };
      }
      if (currentSector === sector && this.flow.phase === 'RACING') {
        return { text: formatShortTime(currentSectorElapsed), tone: 'neutral' as TimingTone };
      }
      return { text: '—', tone: 'neutral' as TimingTone };
    });

    const playerBest = this.playerBestLap();
    const lastTone = timingTone(this.timing.lastLapTime, playerBest, this.sessionFastestLap);
    const bestTone = playerBest === undefined ? 'neutral' : timingTone(playerBest, playerBest, this.sessionFastestLap);
    const fastestText = this.sessionFastestLap === undefined ? '--:--.---' : formatLapTime(this.sessionFastestLap);
    const bannerHtml = banner ? `<div class="race-banner ${banner === 'GO' ? 'go' : ''}">${banner}</div>` : '';
    const launchHtml = this.flow.phase === 'COUNTDOWN'
      ? `<div class="launch-panel"><header><b>RACE START</b><span>PRESS W NEAR LIGHTS OUT</span></header><div class="launch-track"><div class="launch-target"></div><div class="launch-fill" style="width:${Math.round(this.launchCharge * 100)}%"></div></div></div>`
      : this.launchEffectRemaining > 0 && this.launchFeedback
        ? `<div class="launch-feedback ${this.launchFeedbackTone}">${this.launchFeedback}</div>`
        : '';
    const finishHtml = this.flow.phase === 'FINISHED'
      ? `<div class="finish-card"><strong>${this.finishMessage}</strong><span>${legal ? 'LEGAL' : 'TWO COMPOUNDS REQUIRED'} · ${compoundHistory}</span><small>BEST ${formatLapTime(this.timing.bestLapTime)} · PRESS C TO RACE AGAIN</small></div>`
      : '';
    const warningHtml = obligation ? `<div class="race-warning">${obligation}</div>` : '';
    const racingLineHtml = this.racingLineNotice
      ? `<div class="racing-line-notice">${this.racingLineNotice}</div>`
      : '';
    const recoveryHtml = recovery ? `<div class="recovery">STRANDED · PRESS C TO RECOVER</div>` : '';
    const debugHtml = this.renderAiDebugPanel();
    const referenceLap = Math.max(35, Math.min(90, this.sessionFastestLap ?? this.playerBestLap() ?? TRACK_LENGTH / 82));
    const towerHtml = standings.map((driver, index) => {
      const compound = this.compoundFor(driver.id);
      const lastLap = this.lastLapFor(driver.id);
      const gap = !playerStanding || driver.id === 'player'
        ? 0
        : this.raceIntervals.gapSeconds(playerStanding, driver)
          ?? estimatedSignedGapSeconds(playerStanding, driver, referenceLap);
      const gapClass = gap < -TIMING_EPSILON ? 'gap-ahead' : gap > TIMING_EPSILON ? 'gap-behind' : 'gap-self';
      return `<span class="${driver.id === 'player' ? 'you' : ''}"><i>${index + 1}</i><em class="tyre-${compound.toLowerCase()}">${compound[0]}</em><strong>${driver.name}</strong><b class="${gapClass}">${formatSignedRaceGap(gap)}</b><small>${lastLap === undefined ? '—' : formatLapTime(lastLap)}</small></span>`;
    }).join('');

    this.hud.innerHTML = `${bannerHtml}${launchHtml}${finishHtml}${warningHtml}${racingLineHtml}${recoveryHtml}${debugHtml}
      <div class="hud-top">
        <div class="race-id"><b>PITWALL RACER</b><span>P${position} · LAP ${displayLap}/${this.totalLaps} · ${getActiveTrack().name}</span></div>
        <div class="timing-strip"><span>S1 <b class="${this.timingClass(sectorDisplay[0].tone)}">${sectorDisplay[0].text}</b></span><span>S2 <b class="${this.timingClass(sectorDisplay[1].tone)}">${sectorDisplay[1].text}</b></span><span>S3 <b class="${this.timingClass(sectorDisplay[2].tone)}">${sectorDisplay[2].text}</b></span><span>LAST <b class="${this.timingClass(lastTone)}">${formatLapTime(this.timing.lastLapTime)}</b></span><span>PB <b class="${this.timingClass(bestTone)}">${formatLapTime(playerBest)}</b></span><span>FASTEST <b class="timing-purple">${fastestText}</b></span><span>Δ <b>${delta}</b></span></div>
      </div>
      <div class="tower"><div class="tower-head"><i>P</i><i>T</i><i>DRIVER</i><i>GAP</i><i>LAST</i></div>${towerHtml}</div>
      <div class="race-telemetry">
        <div class="mini-map"><header><b>TRACK</b><span>LIVE POSITION</span></header>${this.miniMapSvg()}</div>
        <div class="lap-board"><header><b>LAPS</b><span>TYRE/PIT · S1 · S2 · S3 · LAP</span></header><div class="lap-head" style="grid-template-columns:34px 58px 72px 72px 72px 1fr"><i>#</i><i>TYRE</i><i>S1</i><i>S2</i><i>S3</i><i>LAP</i></div>${this.renderLapBoard()}</div>
      </div>
      <div class="hud-bottom">
        <div class="speedo"><strong>${speed}</strong><span>KM/H</span></div>
        <div class="race-data core-race-data">
          <div><small>TYRE</small><b class="tyre-${this.tire.compound.toLowerCase()}">${this.tire.compound}</b><span class="tyre-strategy-line ${tyreStatusClass}">${wearPct}% USED · ${tyreStatusText}</span></div>
          <div><small>NEXT STOP</small><b class="tyre-${this.selectedCompound.toLowerCase()}">${this.selectedCompound}</b><span>${pitLabel}</span></div>
          <div><small>RACE</small><b>${raceState}</b><span>Q P${gridPosition}${this.setup.qualifyingTime ? ` · ${formatLapTime(this.setup.qualifyingTime)}` : ''}</span></div>
        </div>
      </div>
      <div class="controls">WASD DRIVE · Q SOFT · E MEDIUM · R HARD · F BOX · C RECOVER · F3 AI DEBUG · F4 NEXT AI</div>`;
  }
}

function wrapAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function formatShortTime(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—';
  if (seconds >= 60) return formatLapTime(seconds);
  return seconds.toFixed(3);
}
