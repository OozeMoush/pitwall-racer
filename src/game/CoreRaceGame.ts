import * as THREE from 'three';
import { RaceAudio } from '../audio/RaceAudio';
import { AiReferenceGhost } from '../simulation/AiReferenceGhost';
import {
  normalizedTowStrength,
  towDragMultiplier,
  towPowerBoost,
} from '../simulation/AeroModel';
import { createFormulaCar, type FormulaCar3D } from '../rendering3d/Car3D';
import { createPitLane3D } from '../rendering3d/PitLane3D';
import { createTrack3D } from '../rendering3d/Track3D';
import { headingToYaw, toWorld } from '../rendering3d/WorldTransform';
import { resolveAiOccupancy } from '../simulation/AiOccupancyModel';
import { gridPositionFor, gridSlotForPosition, PLAYER_GRID } from '../simulation/GridModel';
import { stepSteering } from '../simulation/InputModel';
import { ImpactDamageTracker } from '../simulation/ImpactDamageTracker';
import { LapValidityTracker } from '../simulation/LapValidityModel';
import { lapTyreLabel, liveTimingTone } from '../simulation/LapRecordModel';
import {
  loadPlayerRacingLineCandidate,
  PlayerRacingLineCandidateRecorder,
  racingLineTraceQuality,
  saveBestPlayerRacingLineCandidate,
} from '../simulation/PlayerRacingLineCandidate';
import { activateStoredRacingLine } from '../simulation/RacingLineActivation';
import {
  activeReferenceTarget,
  racingLineTraceLapSeconds,
  runtimeRacingLine,
  sampleRuntimeRacingLinePose,
} from '../simulation/RacingLineRuntime';
import { selectedRacingLineSource } from '../simulation/RacingLineSelectionStore';
import { classifyLivePositions, type LiveStandingEntry } from '../simulation/LiveStandingsModel';
import {
  estimatedSignedGapSeconds,
  formatSignedRaceGap,
  RaceIntervalTracker,
} from '../simulation/RaceIntervalModel';
import {
  PIT_BOX_T,
  PIT_SPEED,
  beginPitStop,
  createPitStopState,
  isPitActive,
  pitLanePose,
  pitLaneSpeedLimitActive,
  pitLaneTargetSpeed,
  projectPitLane,
  shouldEnterPit,
  stepPlayerPitStop,
  type PitStopState,
} from '../simulation/PitLaneModel';
import {
  createRaceFlow,
  finishRaceFlow,
  raceBanner,
  raceStartLightCount,
  stepRaceFlow,
  type RaceFlowState,
} from '../simulation/RaceFlow';
import {
  AI_START_REACTION_SECONDS,
  LAUNCH_ACCELERATION_EFFECT_SECONDS,
  evaluateLaunchReaction,
  launchTone,
} from '../simulation/RaceStartModel';
import { canRecover } from '../simulation/RecoveryModel';
import { twoCompoundWarning } from '../simulation/RuleFeedback';
import { selectStartingTyre } from '../simulation/StrategySelection';
import { surfaceEffect } from '../simulation/SurfaceModel';
import {
  createTrackLimitPenaltyState,
  registerTrackLimitWarning,
  serveTrackLimitPitPenalty,
  type TrackLimitPenaltyState,
} from '../simulation/TrackLimitPenaltyModel';
import {
  applyImpactTireDamage,
  createTire,
  stepTire,
  type Compound,
  type TireState,
} from '../simulation/TireModel';
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
import {
  crossedStartLine,
  getActiveTrack,
  projectTrack,
  projectTrackNear,
  sampleTrack,
  TRACK_LENGTH,
} from '../simulation/TrackModel';
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
  private lapForwardProgress = 0;
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
  private launchEffectRemaining = 0;
  private launchPerformanceRemaining = 0;
  private launchAccelerationMultiplier = 1;
  private launchFeedback = '';
  private launchFeedbackTone: 'good' | 'bad' | 'neutral' = 'neutral';
  private lightsOutAtMs?: number;
  private launchThrottleEnabled = false;
  private launchRequiresRelease = false;
  private launchReactionRecorded = false;
  private lineCandidateReferenceGrip = 1;
  private racingLineNotice = '';
  private racingLineNoticeRemaining = 0;
  private lineCandidateStatus = 'ARMING';
  private lineCandidateContact?: 'CAR' | 'BARRIER';
  private trackLimitPenalty: TrackLimitPenaltyState = createTrackLimitPenaltyState();
  private racePenaltyNotice = '';
  private racePenaltyNoticeRemaining = 0;
  private readonly impactDamage = new ImpactDamageTracker();
  private impactDamageNotice = '';
  private impactDamageNoticeRemaining = 0;
  private debugEnabled = false;
  private debugDetailEnabled = false;
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
    this.totalLaps = Math.max(6, Math.min(60, Math.round(setup.totalLaps)));
    this.startCompound = setup.startCompound;
    this.ai = createAiField(setup.gridOrder, this.totalLaps);
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
      if (
        event.code === 'KeyW'
        && this.flow.phase === 'RACING'
        && this.lightsOutAtMs !== undefined
        && !this.launchThrottleEnabled
        && !this.launchRequiresRelease
      ) {
        this.captureLaunchReaction();
      }
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
      if (event.code === 'F5' && this.debugEnabled) {
        event.preventDefault();
        this.debugDetailEnabled = !this.debugDetailEnabled;
      }
    });
    this.container.addEventListener('pointerdown', () => this.audio.unlock(), { passive: true });
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
      if (
        event.code === 'KeyW'
        && this.flow.phase === 'RACING'
        && !this.launchThrottleEnabled
      ) {
        this.launchRequiresRelease = false;
      }
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      if (!this.launchThrottleEnabled) this.launchRequiresRelease = false;
    });
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
    this.racePenaltyNoticeRemaining = Math.max(0, this.racePenaltyNoticeRemaining - dt);
    if (this.racePenaltyNoticeRemaining === 0) this.racePenaltyNotice = '';
    this.impactDamageNoticeRemaining = Math.max(0, this.impactDamageNoticeRemaining - dt);
    if (this.impactDamageNoticeRemaining === 0) this.impactDamageNotice = '';

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
    this.flow = stepRaceFlow(this.flow, dt);
    if (previousPhase === 'COUNTDOWN' && this.flow.phase === 'RACING') {
      this.lightsOutAtMs = performance.now();
      this.launchThrottleEnabled = false;
      this.launchRequiresRelease = this.keys.has('KeyW');
      this.launchReactionRecorded = false;
      this.launchPerformanceRemaining = 0;
      this.launchAccelerationMultiplier = 1;
      this.launchFeedback = this.launchRequiresRelease
        ? 'RELEASE W · THEN PRESS'
        : '';
      this.launchFeedbackTone = this.launchRequiresRelease ? 'bad' : 'neutral';
      this.launchEffectRemaining = this.launchRequiresRelease ? 1.4 : 0;
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
    if (this.launchPerformanceRemaining > 0) {
      this.launchPerformanceRemaining = Math.max(0, this.launchPerformanceRemaining - dt);
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

    const aiLaunchReleased =
      this.lightsOutAtMs === undefined
      || this.timing.raceTime >= AI_START_REACTION_SECONDS;
    if (aiLaunchReleased) {
      this.ai = stepAiField(this.ai, dt, this.totalLaps, playerTraffic, false);
      this.ai = resolveAiOccupancy(this.ai, dt);
      this.physics.syncAiKinematics(this.ai, dt, this.lap);
      this.stepAiDebugGhost(dt);
    }

    if (this.stepPhysicalPit(dt)) {
      this.updateAiLapTiming();
      this.updateRaceIntervals();
      return;
    }

    const launchInputRequired =
      this.lightsOutAtMs !== undefined
      && !this.launchReactionRecorded;
    const throttle =
      this.keys.has('KeyW')
      && (!launchInputRequired || this.launchThrottleEnabled)
        ? 1
        : 0;
    const brake = this.keys.has('KeyS') ? 1 : 0;
    const rawSteer = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    this.steerInput = stepSteering(this.steerInput, rawSteer, this.vehicle.speed, dt);

    const beforeTrack = projectTrackNear(
      this.vehicle.x,
      this.vehicle.y,
      this.trackProgress,
      1.35,
    );
    const physicalSurfaceProjection = projectTrack(
      this.vehicle.x,
      this.vehicle.y,
    );
    const surface = surfaceEffect(physicalSurfaceProjection.distance);
    const aero = aeroEffect(this.lap, beforeTrack.progress, this.ai, beforeTrack.laneOffset);
    const speedLoad = Math.min(1, this.vehicle.speed / 112);
    const corneringLoad = Math.abs(this.steerInput) * speedLoad * 0.92;
    const brakingLoad = brake * speedLoad * 0.82;
    const battleLoad = this.trafficPressure * 0.2;
    const load = Math.min(1.34, corneringLoad + brakingLoad + throttle * 0.13 + surface.severity * 0.7 + battleLoad);

    this.tire = stepTire(this.tire, 'BALANCED', load + aero.dirtyAir * 0.5, dt);

    this.physics.drivePlayer({
      throttle,
      brake,
      steer: this.steerInput,
      tireGrip: this.tire.grip * (1 - aero.dirtyAir * 0.42),
      tireWear: this.tire.wear,
      surfaceGrip: surface.gripMultiplier,
      powerBoost: CORE_POWER_BOOST + towPowerBoost(aero.tow),
      powerMultiplier:
        surface.powerMultiplier
        * (this.launchPerformanceRemaining > 0
          ? this.launchAccelerationMultiplier
          : 1),
      aeroDragMultiplier: towDragMultiplier(aero.tow),
      rollingResistance: surface.rollingResistance,
    }, dt);
    this.physics.step(dt);
    this.vehicle = this.physics.playerState();
    const playerContact = this.physics.playerContactKind();
    const newImpact = this.impactDamage.sample(playerContact, dt);
    if (playerContact !== 'NONE' && newImpact) {
      const impact = applyImpactTireDamage(
        this.tire,
        playerContact,
        this.physics.playerImpactSpeed(),
      );
      this.tire = impact.tire;
      if (impact.wearAdded > 0.0005) {
        this.impactDamageNotice =
          `TYRE DAMAGE +${Math.round(impact.wearAdded * 100)}%`;
        this.impactDamageNoticeRemaining = 2.2;
      }
    }
    if (this.lap >= 1 && playerContact !== 'NONE') {
      this.lineCandidate.markIneligible();
      this.lineCandidateContact = playerContact;
    }
    this.updateAiLapTiming();

    const afterTrack = projectTrackNear(
      this.vehicle.x,
      this.vehicle.y,
      this.trackProgress,
      1.35,
    );
    const afterPhysicalProjection = projectTrack(
      this.vehicle.x,
      this.vehicle.y,
    );
    this.trackDistance = afterPhysicalProjection.distance;
    this.lastTrackProgress = this.trackProgress;
    this.trackProgress = afterPhysicalProjection.progress;
    if (this.lap >= 1) {
      const validityEvent = this.lapValidity.sampleWorld(
        this.vehicle.x,
        this.vehicle.y,
        this.vehicle.heading,
      );
      if (validityEvent !== 'NONE') {
        this.lineCandidate.markIneligible();
        const result = registerTrackLimitWarning(this.trackLimitPenalty);
        this.trackLimitPenalty = result.state;
        this.racePenaltyNotice = result.penaltyAwarded
          ? `TRACK LIMITS · +${result.penaltyAwarded}s PIT PENALTY · BOX TO SERVE`
          : `TRACK LIMIT WARNING · ${this.trackLimitPenalty.warnings}/3`;
        this.racePenaltyNoticeRemaining = result.penaltyAwarded ? 5.0 : 2.8;
      }

      this.lineCandidate.sample(
        afterTrack.progress,
        afterTrack.laneOffset,
        this.vehicle.speed,
        wrapAngle(this.vehicle.heading - afterTrack.heading),
        this.vehicle.yawRate,
        dt,
        this.tire.grip,
        this.physics.playerLongitudinalAcceleration(),
      );
    }
    this.updateSectorTiming();
    this.updateLapAndCheckpoints(afterPhysicalProjection.distance);

    if (shouldEnterPit(
      this.lastTrackProgress,
      this.trackProgress,
      afterPhysicalProjection.distance,
      this.pitRequested,
      afterTrack.laneOffset,
    )) {
      this.lineCandidate.markIneligible();
      const initialPit = projectPitLane(
        this.vehicle.x,
        this.vehicle.y,
        0,
      );
      this.pitStop = beginPitStop(PIT_BOX_T, initialPit.t);
      this.pitRequested = false;
    }

    this.trafficPressure = this.estimateTrafficPressure();
    this.updateRaceIntervals();
  }

  private stepPhysicalPit(dt: number): boolean {
    if (!isPitActive(this.pitStop)) return false;

    this.lineCandidate.markIneligible();
    const beforeState = this.pitStop;

    if (this.pitStop.phase === 'SERVICE') {
      this.pitStop = stepPlayerPitStop(this.pitStop, dt, this.pitStop.t);
      const box = pitLanePose(this.pitStop.boxT);
      this.vehicle = createVehicle(box.x, box.y, box.heading);
      this.physics.setPlayerState(this.vehicle);
      this.physics.step(dt);
      this.vehicle = this.physics.playerState();
    } else {
      const before = projectPitLane(
        this.vehicle.x,
        this.vehicle.y,
        this.pitStop.t,
      );
      const rawSteer =
        (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
      const targetPose = pitLanePose(Math.min(1, before.t + 0.026));
      const targetHeading = Math.atan2(
        targetPose.y - this.vehicle.y,
        targetPose.x - this.vehicle.x,
      );
      const headingError = wrapAngle(targetHeading - this.vehicle.heading);
      const pathAssist = Math.max(
        -1,
        Math.min(
          1,
          headingError * 1.55 - before.lateralOffset * 0.038,
        ),
      );
      const steerCommand = Math.max(
        -1,
        Math.min(1, rawSteer * 0.72 + pathAssist * 0.82),
      );
      this.steerInput = stepSteering(
        this.steerInput,
        steerCommand,
        this.vehicle.speed,
        dt,
      );

      let throttle = this.keys.has('KeyW') ? 1 : 0;
      let brake = this.keys.has('KeyS') ? 1 : 0;
      const targetSpeed = pitLaneTargetSpeed(this.pitStop, before.t);
      if (this.vehicle.speed > targetSpeed) {
        throttle = 0;
        brake = Math.max(
          brake,
          Math.min(1, (this.vehicle.speed - targetSpeed) / 7 + 0.18),
        );
      }

      const speedLoad = Math.min(1, this.vehicle.speed / 60);
      const pitLoad = Math.min(
        1.15,
        Math.abs(this.steerInput) * speedLoad * 0.45
          + brake * speedLoad * 0.55
          + throttle * 0.08,
      );
      this.tire = stepTire(this.tire, 'BALANCED', pitLoad, dt);
      this.physics.drivePlayer({
        throttle,
        brake,
        steer: this.steerInput,
        tireGrip: this.tire.grip,
        tireWear: this.tire.wear,
        surfaceGrip: 1,
        powerBoost: CORE_POWER_BOOST,
        powerMultiplier: 1,
        rollingResistance: 0,
      }, dt);
      this.physics.step(dt);
      this.vehicle = this.physics.playerState();

      const after = projectPitLane(
        this.vehicle.x,
        this.vehicle.y,
        before.t,
      );
      this.pitStop = stepPlayerPitStop(this.pitStop, dt, after.t);

      if (
        beforeState.phase !== 'SERVICE'
        && this.pitStop.phase === 'SERVICE'
      ) {
        // Final docking is deliberately the only positional assist in the
        // player pit sequence. Entry/lane/exit remain real physics.
        const box = pitLanePose(this.pitStop.boxT);
        this.vehicle = createVehicle(box.x, box.y, box.heading);
        this.physics.setPlayerState(this.vehicle);
      }
    }

    if (
      beforeState.phase !== 'SERVICE'
      && this.pitStop.phase === 'SERVICE'
    ) {
      const served = serveTrackLimitPitPenalty(this.trackLimitPenalty);
      this.trackLimitPenalty = served.state;
      if (served.seconds > 0) {
        this.pitStop = {
          ...this.pitStop,
          serviceRemaining: this.pitStop.serviceRemaining + served.seconds,
        };
        this.racePenaltyNotice =
          `SERVING ${served.seconds}s TRACK LIMIT PENALTY`;
        this.racePenaltyNoticeRemaining = served.seconds + 1.5;
      }
    }

    if (!beforeState.tyreChanged && this.pitStop.tyreChanged) {
      this.lapPitted = true;
      this.tire = createTire(this.selectedCompound);
      this.usedCompounds.add(this.selectedCompound);
      this.playerCar.setCompound(this.selectedCompound);
    }

    this.lastTrackProgress = this.trackProgress;
    const timingPose = pitLanePose(
      this.pitStop.phase === 'DONE' ? 1 : this.pitStop.t,
    );
    this.trackProgress = timingPose.raceProgress;
    this.trackDistance = 0;
    this.updateSectorTiming();
    this.updateLapAndCheckpoints(0);
    this.trafficPressure = 0;

    if (this.pitStop.phase === 'DONE') {
      this.pitStop = createPitStopState();
    }
    return true;
  }

  private updateSectorTiming(): void {
    if (this.lap === 0) return;
    if (this.lastTrackProgress > this.trackProgress) return;
    while (this.nextSector <= 2) {
      const threshold = SECTOR_BOUNDARIES[this.nextSector - 1];
      if (this.lastTrackProgress < threshold && this.trackProgress >= threshold) {
        const index = this.nextSector - 1;
        const sectorTime = this.timing.raceTime - this.sectorStartTime;
        this.sectorTimes.push(sectorTime);
        this.sectorTones.push(this.newSectorTone(index, sectorTime));
        this.registerSessionFastestSector(index, sectorTime);
        this.sectorStartTime = this.timing.raceTime;
        this.nextSector += 1;
      } else break;
    }
  }

  private updateLapAndCheckpoints(distanceFromLine: number): void {
    if (distanceFromLine > 82) return;
    const crossedStart = crossedStartLine(this.lastTrackProgress, this.trackProgress);

    if (this.lap === 0) {
      if (crossedStart) {
        this.lap = 1;
        this.lapForwardProgress = 0;
        // The grid-to-line rollout is not part of lap 1. Reset both the lap
        // clock and sector state exactly at the first timing-line crossing so
        // the rollout cannot reappear later as an inflated S3.
        this.timing = {
          ...this.timing,
          lapStartTime: this.timing.raceTime,
          currentLapTime: 0,
        };
        this.nextSector = 1;
        this.sectorStartTime = this.timing.raceTime;
        this.sectorTimes = [];
        this.sectorTones = [];
        this.lapStartCompound = this.tire.compound;
        this.lapPitted = false;
        this.lapValidity.reset();
        this.beginRaceLineCandidate();
        this.lineCandidate.markIneligible();
      }
      return;
    }

    const rawDelta = this.trackProgress - this.lastTrackProgress;
    const continuousDelta = rawDelta < -0.5
      ? rawDelta + 1
      : rawDelta > 0.5
        ? rawDelta - 1
        : rawDelta;

    // Accumulate real forward lap progress instead of demanding exact
    // intermediate checkpoints. Large projection teleports are ignored.
    if (continuousDelta > 0 && continuousDelta < 0.06) {
      this.lapForwardProgress = Math.min(
        1.25,
        this.lapForwardProgress + continuousDelta,
      );
    }

    // Track limits never delete a Grand Prix lap. A forward start-line crossing
    // counts once most of the circuit has actually been traversed.
    if (!(crossedStart && this.lapForwardProgress >= 0.68)) return;

    const lapTime = this.timing.raceTime - this.timing.lapStartTime;
    const s1 = this.sectorTimes[0] ?? lapTime / 3;
    const s2 = this.sectorTimes[1] ?? lapTime / 3;
    const s3 = Math.max(0, lapTime - s1 - s2);
    this.sectorTones[2] = this.newSectorTone(2, s3);
    // Grand Prix track limits are accumulated as race penalties. The physical
    // lap still happened and must always advance timing/lap count. Racing-line
    // eligibility remains stricter and is checked separately below.
    const validLap = true;
    [s1, s2, s3].forEach((sectorTime, index) => {
      this.registerSessionFastestSector(index, sectorTime);
    });
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
    this.lapForwardProgress = 0;
    this.nextSector = 1;
    this.sectorStartTime = this.timing.raceTime;
    this.sectorTimes = [];
    this.sectorTones = [];
    this.lapStartCompound = this.tire.compound;
    this.lapPitted = false;
    this.lapValidity.reset();
    this.beginRaceLineCandidate();

    if (this.lap > this.totalLaps) {
      const compoundsLegal = isTwoCompoundLegal(this.usedCompounds);
      const penaltyLegal = this.trackLimitPenalty.pendingPitSeconds <= 0;
      const legal = compoundsLegal && penaltyLegal;
      const standings = this.standings();
      const position = standings.findIndex((driver) => driver.id === 'player') + 1;
      this.flow = finishRaceFlow(this.flow);
      this.finishMessage = legal
        ? `P${position} · FINISH`
        : !penaltyLegal
          ? `P${position} · DISQUALIFIED · UNSERVED PENALTY`
          : `P${position} · DISQUALIFIED`;
      this.physics.stopPlayer();
      this.vehicle = this.physics.playerState();
    }
  }

  private beginRaceLineCandidate(): void {
    this.lineCandidateReferenceGrip = this.tire.grip;
    this.lineCandidate.begin(this.setup.trackId, this.lineCandidateReferenceGrip);
    this.lineCandidateContact = undefined;
  }

  private commitRaceLineCandidate(lapTime: number, validLap: boolean): void {
    const eligibility = this.lapValidity.snapshot();
    const previous = loadPlayerRacingLineCandidate(
      window.localStorage,
      this.setup.trackId,
    );
    const previousSeconds = previous?.lapSeconds;
    const rejectionReasons: string[] = [];

    if (!validLap) rejectionReasons.push('INVALID LAP');
    if (this.lap < 2) rejectionReasons.push('LAP 1');
    if (this.lapPitted) rejectionReasons.push('PIT');
    if (this.lineCandidateContact === 'CAR') rejectionReasons.push('CAR CONTACT');
    if (this.lineCandidateContact === 'BARRIER') rejectionReasons.push('WALL CONTACT');
    if (!eligibility.candidateEligible) {
      rejectionReasons.push(
        eligibility.warnings > 0
          ? `TRACK LIMITS ${eligibility.warnings}`
          : 'RECOVERY',
      );
    }
    if (rejectionReasons.length > 0) {
      this.lineCandidateStatus = `REJECT · ${rejectionReasons.join(' + ')}`;
      if (
        previousSeconds !== undefined
        && lapTime < previousSeconds - 0.0005
      ) {
        this.racingLineNotice = `LINE NOT SAVED · ${rejectionReasons.join(' · ')}`;
        this.racingLineNoticeRemaining = 3.2;
      }
      return;
    }

    const candidate = this.lineCandidate.finish(lapTime);
    if (!candidate) {
      this.lineCandidateStatus = 'REJECT · INCOMPLETE TRACE';
      return;
    }

    const previousQuality = racingLineTraceQuality(previous);
    const candidateQuality = racingLineTraceQuality(candidate);
    const saved = saveBestPlayerRacingLineCandidate(
      window.localStorage,
      candidate,
    );
    const storedNewCandidate = saved === candidate;

    if (!storedNewCandidate) {
      this.lineCandidateStatus = candidateQuality < previousQuality
        ? `REJECT · TRACE Q${candidateQuality}<Q${previousQuality}`
        : `KEPT · ${previousSeconds?.toFixed(3) ?? '—'}s`;
      return;
    }

    const qualityUpgrade = previous !== undefined
      && candidateQuality > previousQuality;
    const improved = previousSeconds === undefined
      || candidate.lapSeconds === undefined
      || candidate.lapSeconds < previousSeconds - 0.0005;

    const usingPlayerLine = selectedRacingLineSource(
      window.localStorage,
      this.setup.trackId,
    ) === 'PLAYER';
    if (usingPlayerLine) {
      activateStoredRacingLine(window.localStorage, this.setup.trackId);
      if (this.debugEnabled) {
        this.resetAiDebugGhost();
        this.refreshAiDebugReferenceLine();
      }
    }

    this.lineCandidateStatus = `SAVED · ${lapTime.toFixed(3)}s · Q${candidateQuality}`;
    this.racingLineNotice = qualityUpgrade
      ? usingPlayerLine
        ? `CPU LINE UPGRADED · Q${candidateQuality}`
        : `PLAYER LINE UPGRADED · Q${candidateQuality}`
      : improved
        ? usingPlayerLine
          ? `CPU LINE UPDATED · ${lapTime.toFixed(3)}s`
          : `PLAYER LINE SAVED · ${lapTime.toFixed(3)}s`
        : `PLAYER LINE STORED · Q${candidateQuality}`;
    this.racingLineNoticeRemaining = 3.2;

    console.info('RACING_LINE_CANDIDATE', {
      trackId: saved.trackId,
      source: saved.source,
      lapSeconds: saved.lapSeconds,
      points: saved.points.length,
      raceLap: this.lap,
      activatedForCpu: usingPlayerLine,
      qualityUpgrade,
      traceQuality: candidateQuality,
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
      car.root.rotation.z = driver.battleState === 'SIDE_BY_SIDE' ? 0.009 : 0;
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
      this.disposeAiDebugGhost();
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

  private disposeAiDebugGhost(): void {
    if (!this.debugGhost) return;
    this.debugGhost.physics.world.free();
    this.debugGhost = undefined;
  }

  private resetAiDebugGhost(): void {
    // Reference replay should answer whether the stored PLAYER lap itself can
    // be reproduced. Start exactly at the lap seam using the stored speed,
    // heading and yaw rather than inheriting a standing-start/warmup history.
    this.disposeAiDebugGhost();
    this.debugGhost = new AiReferenceGhost(0, this.setup.trackId, true);
    this.debugLineRefreshRemaining = 0;
  }

  private refreshAiDebugReferenceLine(): void {
    if (!this.debugReferenceLine) return;
    const grip = this.ai[this.debugAiIndex]?.tire.grip ?? this.tire.grip;
    const lineAsset = runtimeRacingLine(this.setup.trackId);
    const highFidelity =
      lineAsset?.source === 'PLAYER' || lineAsset?.source === 'EDITOR';
    const points = Array.from({ length: 240 }, (_, index) => {
      const progress = index / 240;
      if (highFidelity) {
        const pose = sampleRuntimeRacingLinePose(this.setup.trackId, progress);
        return toWorld(pose.x, pose.y, 0.17);
      }
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

  private captureLaunchReaction(): void {
    if (
      this.lightsOutAtMs === undefined
      || this.launchReactionRecorded
      || this.launchRequiresRelease
    ) return;

    this.launchThrottleEnabled = true;
    this.launchReactionRecorded = true;
    const launch = evaluateLaunchReaction(
      Math.max(0, performance.now() - this.lightsOutAtMs) / 1000,
    );
    this.launchFeedback = launch.label;
    this.launchFeedbackTone = launchTone(launch.quality);
    this.launchAccelerationMultiplier = launch.accelerationMultiplier;
    this.launchPerformanceRemaining = LAUNCH_ACCELERATION_EFFECT_SECONDS;
    this.launchEffectRemaining = 2.2;
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
    this.lapForwardProgress = 0;
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
    this.lineCandidateReferenceGrip = this.tire.grip;
    this.racingLineNotice = '';
    this.racingLineNoticeRemaining = 0;
    this.lineCandidateStatus = 'ARMING';
    this.lineCandidateContact = undefined;
    this.sessionFastestLap = undefined;
    this.sessionFastestSectors = [undefined, undefined, undefined];
    this.fixedAccumulator = 0;
    this.launchEffectRemaining = 0;
    this.launchPerformanceRemaining = 0;
    this.launchAccelerationMultiplier = 1;
    this.launchFeedback = '';
    this.launchFeedbackTone = 'neutral';
    this.lightsOutAtMs = undefined;
    this.launchThrottleEnabled = false;
    this.launchRequiresRelease = false;
    this.launchReactionRecorded = false;
    this.raceIntervals.reset();
    this.impactDamage.reset();
    this.impactDamageNotice = '';
    this.impactDamageNoticeRemaining = 0;
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
    const traceLapSeconds = racingLineTraceLapSeconds(line);
    const traceLap = traceLapSeconds === undefined ? '—' : `${traceLapSeconds.toFixed(3)}s`;
    const traceDelta = line?.lapSeconds !== undefined && traceLapSeconds !== undefined
      ? traceLapSeconds - line.lapSeconds
      : undefined;
    const ghostLap = this.debugGhost?.lastLapSeconds();
    const ghostCurrent = this.debugGhost?.currentLapSeconds();
    const ghostWorstLoss = this.debugGhost?.lastWorstLoss();
    const ghostFirstSpeedDrift = this.debugGhost?.lastFirstSpeedDrift();
    const ghostTime = ghostLap !== undefined
      ? `${ghostLap.toFixed(3)}s LAST`
      : ghostCurrent !== undefined
        ? `${ghostCurrent.toFixed(3)}s LIVE`
        : 'ARMING';

    const cpuDetails = this.debugDetailEnabled
      ? `
        <span>LANE actual / ref</span><b>${fixed(driver?.laneOffset)} / ${fixed(control?.debug.referenceLane)}</b>
        <span>LANE ERROR</span><b style="color:${Math.abs(control?.debug.laneError ?? 0) > 2 ? '#ff6978' : '#dce9e4'}">${fixed(control?.debug.laneError)} m</b>
        <span>HEADING / BEARING</span><b>${degrees(control?.debug.pathHeadingError)} / ${degrees(control?.debug.bearingError)}</b>
        <span>BRAKE fb / profile</span><b>${fixed(control?.debug.feedbackBrake)} / ${fixed(control?.debug.profileBrake)}</b>
        <span>THROTTLE profile</span><b>${fixed(control?.debug.profileThrottle)}</b>
        <span>LOOKAHEAD / PREDICT</span><b>${fixed(control?.debug.lookAheadMetres, 1)} m / ${percent(control?.debug.predictionWeight)}</b>
      `
      : '';

    const ghostDetails = this.debugDetailEnabled
      ? `
        <span>LANE ERROR</span><b>${fixed(ghostControl?.debug.laneError)} m</b>
        <span>STATE TRACE</span><b>${ghostControl?.debug.demonstratedAcceleration ? (ghostControl?.debug.demonstratedForwardAcceleration ? 'HEADING + YAW + AXF + GRIP' : ghostControl?.debug.demonstratedGripTrace ? 'HEADING + YAW + AX + GRIP' : 'HEADING + YAW + AX') : ghostControl?.debug.demonstratedDynamics ? 'HEADING + YAW' : 'LEGACY'}</b>
        <span>HEADING err</span><b>${degrees(ghostControl?.debug.pathHeadingError)}</b>
        <span>THROTTLE profile</span><b>${fixed(ghostControl?.debug.profileThrottle)}</b>
      `
      : '';

    return `<div style="position:absolute;right:14px;top:88px;width:min(620px,calc(100vw - 28px));max-height:calc(100vh - 104px);overflow:auto;box-sizing:border-box;padding:10px 12px;background:rgba(3,10,12,.94);border:1px solid rgba(72,255,116,.5);box-shadow:0 8px 28px rgba(0,0,0,.35);font:11px/1.28 ui-monospace,SFMono-Regular,Consolas,monospace;color:#dce9e4;z-index:30">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:7px;position:sticky;top:-10px;background:rgba(3,10,12,.97);padding:5px 0;z-index:1">
        <b style="color:#48ff74;letter-spacing:.08em">AI LINE DEBUG</b>
        <span>F3 OFF · F4 NEXT · F5 ${this.debugDetailEnabled ? 'COMPACT' : 'DETAIL'}</span>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:4px 14px;padding-bottom:7px;border-bottom:1px solid rgba(255,255,255,.12)">
        <span>AI <b>${driver?.name ?? '—'} [${this.debugAiIndex + 1}/${this.ai.length}]</b></span>
        <span>LINE <b style="color:#48ff74">${source}</b></span>
        <span>LAP <b>${lap}</b></span>
        <span>TRACE <b style="color:${Math.abs(traceDelta ?? 0) > 0.5 ? '#ff6978' : '#48ff74'}">${traceLap}${traceDelta === undefined ? '' : ` (${traceDelta >= 0 ? '+' : ''}${traceDelta.toFixed(3)})`}</b></span>
        <span>MODE <b>${control?.battleState ?? '—'}</b></span>
        <span>PRESSURE <b>${Math.round(this.trafficPressure * 100)}%</b></span>
      </div>

      <div style="margin:6px 0 7px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:3px 10px">
        <span>STATE</span><b style="color:${control?.debug.demonstratedDynamics ? '#48ff74' : '#ffc94d'}">${control?.debug.demonstratedAcceleration ? (control?.debug.demonstratedForwardAcceleration ? 'HEADING + YAW + AXF + GRIP' : control?.debug.demonstratedGripTrace ? 'HEADING + YAW + AX + GRIP' : 'HEADING + YAW + AX') : control?.debug.demonstratedDynamics ? 'HEADING + YAW' : 'LEGACY'}</b>
        <span>LAST</span><b style="color:${this.lineCandidateStatus.startsWith('REJECT') ? '#ff6978' : this.lineCandidateStatus.startsWith('SAVED') ? '#48ff74' : '#dce9e4'}">${this.lineCandidateStatus}</b>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px">
        <section style="min-width:0;padding-top:6px;border-top:1px solid rgba(72,255,116,.28)">
          <div style="display:flex;justify-content:space-between;margin-bottom:5px"><b style="color:#48ff74">SELECTED CPU</b><span>${driver?.name ?? '—'}</span></div>
          <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 10px">
            <span>PROGRESS c / p</span><b>${fixed((control?.debug.centerProgress ?? 0) * 100, 1)} / ${fixed((control?.debug.progress ?? 0) * 100, 1)}%</b>
            <span>PATH ERROR</span><b style="color:${(control?.debug.pathError ?? 0) > 1.8 ? '#ff6978' : '#dce9e4'}">${fixed(control?.debug.pathError)} m</b>
            <span>SPEED actual / target</span><b>${fixed(state ? state.speed * 3.6 : undefined, 0)} / ${fixed(control ? control.targetSpeed * 3.6 : undefined, 0)} km/h</b>
            <span>GRIP actual / source</span><b>${fixed(driver?.tire.grip, 3)} / ${fixed(control?.debug.sourceGrip, 3)}</b>
            <span>AXF actual / source</span><b>${fixed(this.physics.aiLongitudinalAcceleration(this.debugAiIndex), 2)} / ${fixed(control?.debug.sourceForwardAcceleration, 2)}</b>
            <span>AX net actual / source</span><b>${fixed(this.physics.aiNetSpeedAcceleration(this.debugAiIndex), 2)} / ${fixed(control?.debug.sourceNetSpeedAcceleration, 2)}</b>
            <span>STEER / THROTTLE</span><b>${fixed(control?.steer)} / ${fixed(control?.throttle)}</b>
            <span>YAW actual / target</span><b>${degreesPerSecond(state?.yawRate)} / ${degreesPerSecond(control?.debug.targetYawRate)}</b>
            <span>BRAKE final</span><b>${fixed(control?.brake)}</b>
            ${cpuDetails}
          </div>
        </section>

        <section style="min-width:0;padding-top:6px;border-top:1px solid rgba(57,223,255,.28)">
          <div style="display:flex;justify-content:space-between;margin-bottom:5px"><b style="color:#39dfff">REFERENCE GHOST</b><span>TRAFFIC OFF · 100%</span></div>
          <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:3px 10px">
            <span>LAP</span><b>${ghostTime}</b>
            <span>PROGRESS c / p</span><b>${fixed((ghostControl?.debug.centerProgress ?? 0) * 100, 1)} / ${fixed((ghostControl?.debug.progress ?? 0) * 100, 1)}%</b>
            <span>PATH ERROR</span><b style="color:${(ghostControl?.debug.pathError ?? 0) > 1.8 ? '#ff6978' : '#dce9e4'}">${fixed(ghostControl?.debug.pathError)} m</b>
            <span>SPEED actual / target</span><b>${fixed(ghostState ? ghostState.speed * 3.6 : undefined, 0)} / ${fixed(ghostControl ? ghostControl.targetSpeed * 3.6 : undefined, 0)} km/h</b>
            <span>GRIP actual / source</span><b>${fixed(this.debugGhost?.driver.tire.grip, 3)} / ${fixed(ghostControl?.debug.sourceGrip, 3)}</b>
            <span>AXF actual / source</span><b>${fixed(this.debugGhost?.latestForwardAcceleration(), 2)} / ${fixed(ghostControl?.debug.sourceForwardAcceleration, 2)}</b>
            <span>AX net actual / source</span><b>${fixed(this.debugGhost?.latestNetSpeedAcceleration(), 2)} / ${fixed(ghostControl?.debug.sourceNetSpeedAcceleration, 2)}</b>
            <span>YAW actual / target</span><b>${degreesPerSecond(ghostState?.yawRate)} / ${degreesPerSecond(ghostControl?.debug.targetYawRate)}</b>
            <span>SLIP actual / source</span><b>${degrees(this.debugGhost?.latestSlipAngle())} / ${degrees(this.debugGhost?.sourceSlipAngle())}</b>
            <span>CONTROL S / B / T</span><b>${fixed(ghostControl?.steer)} / ${fixed(ghostControl?.brake)} / ${fixed(ghostControl?.throttle)}</b>
            <span>FIRST |Δv|≥15</span><b style="color:#ffc94d">${fixed(ghostFirstSpeedDrift === undefined ? undefined : ghostFirstSpeedDrift.progress * 100, 1)}% · Δv ${fixed(ghostFirstSpeedDrift?.speedDeltaKph, 0)} km/h</b>
            <span>DRIFT cause</span><b>AXF ${fixed(ghostFirstSpeedDrift?.actualForwardAcceleration, 1)}/${fixed(ghostFirstSpeedDrift?.sourceForwardAcceleration, 1)} · B ${fixed(ghostFirstSpeedDrift?.feedbackBrake)}/${fixed(ghostFirstSpeedDrift?.profileBrake)} · T ${fixed(ghostFirstSpeedDrift?.throttle)}</b>
            <span>DRIFT state</span><b>path ${fixed(ghostFirstSpeedDrift?.pathError, 2)}m · yawΔ ${degreesPerSecond(ghostFirstSpeedDrift?.yawError)}</b>
            <span>WORST AX net Δ</span><b style="color:${(ghostWorstLoss?.netAccelerationDelta ?? 0) < -3 ? '#ff6978' : '#dce9e4'}">${fixed(ghostWorstLoss?.netAccelerationDelta, 2)} m/s² @ ${fixed(ghostWorstLoss === undefined ? undefined : ghostWorstLoss.progress * 100, 1)}%</b>
            <span>LOSS context</span><b>Δv ${fixed(ghostWorstLoss?.speedDeficitKph, 0)} km/h · path ${fixed(ghostWorstLoss?.pathError, 2)}m · yawΔ ${degreesPerSecond(ghostWorstLoss?.yawError)}</b>
            ${ghostDetails}
          </div>
        </section>
      </div>
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
    const startLightCount = raceStartLightCount(this.flow);
    const compoundLegal = isTwoCompoundLegal(this.usedCompounds);
    const penaltyLegal = this.trackLimitPenalty.pendingPitSeconds <= 0;
    const legal = compoundLegal && penaltyLegal;
    const displayLap = Math.max(1, Math.min(this.lap, this.totalLaps));
    const obligation = this.flow.phase === 'RACING'
      ? twoCompoundWarning(this.usedCompounds, this.tire.compound, this.selectedCompound, displayLap, this.totalLaps, this.pitRequested || isPitActive(this.pitStop))
      : undefined;
    const recovery = this.flow.phase === 'RACING' && !isPitActive(this.pitStop) && canRecover(this.trackDistance, this.vehicle.speed);
    const speed = Math.round(this.vehicle.speed * 3.6);
    const wearPct = Math.round(this.tire.wear * 100);
    const tyreWearClass = wearPct >= 80
      ? 'critical'
      : wearPct >= 58
        ? 'warning'
        : 'healthy';
    const towPct = Math.round(normalizedTowStrength(aero.tow) * 100);
    const compoundHistory = [...this.usedCompounds].join(' → ');
    const delta = this.timing.deltaToBest === undefined ? '—' : `${this.timing.deltaToBest >= 0 ? '+' : ''}${this.timing.deltaToBest.toFixed(3)}`;
    const gridPosition = gridPositionFor('player', this.setup.gridOrder) ?? 8;
    const pitLabel = this.flow.phase === 'COUNTDOWN'
      ? `START ${this.tire.compound} · GRID P${gridPosition}`
      : this.pitStop.phase === 'SERVICE'
        ? `PIT BOX · ${this.pitStop.serviceRemaining.toFixed(1)}s`
        : isPitActive(this.pitStop)
          ? `${pitLaneSpeedLimitActive(this.pitStop.t) ? 'PIT LIMIT 80' : 'PIT LANE'} · ${this.pitStop.phase === 'TRANSIT_IN' ? 'IN' : 'OUT'}`
          : this.pitRequested
            ? `BOX THIS LAP · TAKE RIGHT ENTRY → ${this.selectedCompound}`
            : this.trackLimitPenalty.pendingPitSeconds > 0
              ? `PENALTY ${this.trackLimitPenalty.pendingPitSeconds}s · F TO BOX`
              : `NEXT ${this.selectedCompound} · F TO BOX`;
    const slideSeverity = this.physics.playerSlideSeverity();
    const raceState = this.trackLimitPenalty.pendingPitSeconds > 0
      ? `PENALTY ${this.trackLimitPenalty.pendingPitSeconds}s · BOX TO SERVE`
      : this.trackLimitPenalty.warnings > 0
        ? `TRACK LIMITS ${this.trackLimitPenalty.warnings}/3`
        : slideSeverity > 0.15
          ? 'REAR SLIDE'
      : surface.label !== 'TRACK'
        ? surface.label
        : this.trafficPressure > 0.18 && aero.dirtyAir < 0.025
          ? 'SIDE BY SIDE · CLEAN AIR'
          : aero.dirtyAir > 0.01
            ? `DIRTY AIR ${(aero.dirtyAir * 100).toFixed(0)}%`
            : aero.tow > 0.01
              ? 'SLIPSTREAM'
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
      if (this.lap >= 1 && currentSector === sector && this.flow.phase === 'RACING') {
        return { text: formatShortTime(currentSectorElapsed), tone: 'neutral' as TimingTone };
      }
      return { text: '—', tone: 'neutral' as TimingTone };
    });

    const playerBest = this.playerBestLap();
    const lastTone = timingTone(this.timing.lastLapTime, playerBest, this.sessionFastestLap);
    const bestTone = playerBest === undefined ? 'neutral' : timingTone(playerBest, playerBest, this.sessionFastestLap);
    const fastestText = this.sessionFastestLap === undefined ? '--:--.---' : formatLapTime(this.sessionFastestLap);
    const bannerHtml = '';
    const showStartLights =
      this.flow.phase === 'COUNTDOWN'
      || banner === 'LIGHTS_OUT';
    const startLights = Array.from({ length: 5 }, (_, index) =>
      `<i class="${this.flow.phase === 'COUNTDOWN' && index < startLightCount ? 'on' : ''}"></i>`
    ).join('');
    const startPrompt = this.flow.phase === 'COUNTDOWN'
      ? 'PRESS W WHEN THE LIGHTS GO OUT'
      : this.launchRequiresRelease
        ? 'RELEASE W · THEN PRESS'
        : 'LIGHTS OUT';
    const launchHtml = showStartLights
      ? `<div class="start-light-panel"><div class="start-lights">${startLights}</div><b>${startPrompt}</b></div>`
      : this.launchEffectRemaining > 0 && this.launchFeedback
        ? `<div class="launch-feedback ${this.launchFeedbackTone}">${this.launchFeedback}</div>`
        : '';
    const finishRuleText = legal
      ? 'LEGAL'
      : !penaltyLegal
        ? `UNSERVED TRACK LIMIT PENALTY · ${this.trackLimitPenalty.pendingPitSeconds}s`
        : 'TWO COMPOUNDS REQUIRED';
    const finishHtml = this.flow.phase === 'FINISHED'
      ? `<div class="finish-card"><strong>${this.finishMessage}</strong><span>${finishRuleText} · ${compoundHistory}</span><small>BEST ${formatLapTime(this.timing.bestLapTime)} · PRESS C TO RACE AGAIN</small></div>`
      : '';
    const warningHtml = obligation ? `<div class="race-warning">${obligation}</div>` : '';
    const penaltyHtml = this.racePenaltyNotice
      ? `<div class="race-warning" style="top:118px">${this.racePenaltyNotice}</div>`
      : '';
    const impactDamageHtml = this.impactDamageNotice
      ? `<div class="race-warning" style="top:158px;color:#ff8892;border-color:rgba(255,95,109,.55)">${this.impactDamageNotice}</div>`
      : '';
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
      const aiIndex = this.ai.findIndex((entry) => entry.id === driver.id);
      const carColor = aiIndex >= 0 ? AI_COLORS[aiIndex] ?? 0xffffff : 0x31b9ef;
      const carColorHex = `#${carColor.toString(16).padStart(6, '0')}`;
      const carBadge = driver.id === 'player'
        ? ''
        : `<u title="CAR ${aiIndex + 1}" style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;margin-right:6px;padding:0 3px;border-radius:4px;background:${carColorHex};color:#071014;text-decoration:none;font-size:10px;font-weight:950;line-height:1">${aiIndex + 1}</u>`;
      return `<span class="${driver.id === 'player' ? 'you' : ''}"><i>${index + 1}</i><em class="tyre-${compound.toLowerCase()}">${compound[0]}</em><strong style="display:flex;align-items:center;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${carBadge}${driver.name}</strong><b class="${gapClass}">${formatSignedRaceGap(gap)}</b><small>${lastLap === undefined ? '—' : formatLapTime(lastLap)}</small></span>`;
    }).join('');

    this.hud.innerHTML = `${bannerHtml}${launchHtml}${finishHtml}${warningHtml}${penaltyHtml}${impactDamageHtml}${racingLineHtml}${recoveryHtml}${debugHtml}
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
          <div class="tyre-wear-card"><small>TYRE</small><b class="tyre-${this.tire.compound.toLowerCase()}">${this.tire.compound} <em class="tyre-wear-value ${tyreWearClass}">WEAR ${wearPct}%</em></b><span class="tyre-wear-meter ${tyreWearClass}" aria-label="tyre wear ${wearPct} percent"><i style="width:${wearPct}%"></i></span></div>
          <div><small>NEXT STOP</small><b class="tyre-${this.selectedCompound.toLowerCase()}">${this.selectedCompound}</b><span>${pitLabel}</span></div>
          <div class="tow-card ${towPct > 0 ? 'active' : ''}" title="Slipstream strength relative to the strongest usable tow"><small>SLIPSTREAM</small><b>${towPct > 0 ? `TOW ${towPct}%` : 'NO TOW'}</b><span class="tow-meter" aria-label="tow strength ${towPct} percent"><i style="width:${towPct}%"></i></span></div>
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
