import * as THREE from 'three';
import { RaceAudio } from '../audio/RaceAudio';
import { createFormulaCar } from '../rendering3d/Car3D';
import { createPitLane3D } from '../rendering3d/PitLane3D';
import { createTrack3D } from '../rendering3d/Track3D';
import { headingToYaw, toWorld } from '../rendering3d/WorldTransform';
import { stepSteering } from '../simulation/InputModel';
import { LapValidityTracker } from '../simulation/LapValidityModel';
import { assessEmpiricalLap, calibratedPaceBenchmark } from '../simulation/PaceBenchmarkModel';
import { PaceEvidenceAccumulator } from '../simulation/PaceEvidenceAccumulator';
import { loadPaceEvidence, savePaceEvidence } from '../simulation/PaceBenchmarkStore';
import {
  loadPlayerRacingLineCandidate,
  PlayerRacingLineCandidateRecorder,
  saveBestPlayerRacingLineCandidate,
} from '../simulation/PlayerRacingLineCandidate';
import {
  qualifyingBenchmarkSeconds,
  qualifyingClassification,
  qualifyingGridOrder,
  type QualifyingEntry,
} from '../simulation/QualifyingModel';
import { RapierRacePhysics } from '../simulation/RapierRacePhysics';
import { referenceTarget } from '../simulation/ReferenceDriverModel';
import { createAiField } from '../simulation/RaceModel';
import { surfaceEffect } from '../simulation/SurfaceModel';
import { createTire, stepTire, type TireState } from '../simulation/TireModel';
import { formatLapTime } from '../simulation/TimingModel';
import {
  loadTimeTrialRecord,
  saveTimeTrialLap,
  type TimeTrialRecord,
} from '../simulation/TimeTrialRecordStore';
import {
  crossedStartLine,
  getActiveTrack,
  projectTrack,
  sampleTrack,
  TRACK_LENGTH,
} from '../simulation/TrackModel';
import { createVehicle, type VehicleState } from '../simulation/VehicleModel';
import type { RaceSetup } from './RaceSetup';

const FIXED_DT = 1 / 120;
const CAMERA_HALF_HEIGHT = 19.5;
const CAMERA_OFFSET = new THREE.Vector3(18.5, 34, 18.5);
const START_PROGRESS = 0.72;
const CORE_POWER_BOOST = 0.22;
const RESULT_HOLD_SECONDS = 4.2;
const SOLO_SECTOR_BOUNDARIES = [1 / 3, 2 / 3] as const;

type QualifyingPhase = 'COUNTDOWN' | 'APPROACH' | 'FLYING' | 'RESULTS';
type SoloSessionMode = 'QUALIFYING' | 'TIME_TRIAL';

export interface QualifyingSessionResult {
  playerTime: number;
  playerPosition: number;
  gridOrder: string[];
  classification: QualifyingEntry[];
}

export function runQualifyingSession(
  container: HTMLElement,
  hud: HTMLElement,
  setup: RaceSetup,
): Promise<QualifyingSessionResult> {
  return new Promise((resolve) => {
    new QualifyingGame(container, hud, setup, 'QUALIFYING', resolve);
  });
}

export function runTimeTrialSession(
  container: HTMLElement,
  hud: HTMLElement,
  setup: RaceSetup,
): Promise<void> {
  return new Promise((resolve) => {
    new QualifyingGame(container, hud, setup, 'TIME_TRIAL', undefined, resolve);
  });
}

class QualifyingGame {
  private readonly container: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly setup: RaceSetup;
  private readonly mode: SoloSessionMode;
  private readonly resolveQualifying?: (result: QualifyingSessionResult) => void;
  private readonly resolveTimeTrial?: () => void;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-40, 40, CAMERA_HALF_HEIGHT, -CAMERA_HALF_HEIGHT, 0.1, 460);
  private readonly keys = new Set<string>();
  private readonly car = createFormulaCar(0x31b9ef, 'SOFT', true);
  private readonly cameraTarget = new THREE.Vector3();
  private readonly audio = new RaceAudio();
  private readonly physics: RapierRacePhysics;
  private readonly paceEvidence = new PaceEvidenceAccumulator();
  private readonly lapValidity = new LapValidityTracker();
  private readonly lineCandidate = new PlayerRacingLineCandidateRecorder();

  private vehicle: VehicleState;
  private tire: TireState = createTire('SOFT');
  private phase: QualifyingPhase = 'APPROACH';
  private countdown = 3;
  private fixedAccumulator = 0;
  private lastFrame = performance.now();
  private frameId = 0;
  private steerInput = 0;
  private lastProgress = START_PROGRESS;
  private currentProgress = START_PROGRESS;
  private nextCheckpoint = 1;
  private lapTime = 0;
  private resultHold = 0;
  private lapNotice = '';
  private lapNoticeRemaining = 0;
  private result?: QualifyingSessionResult;
  private resolved = false;
  private completedLaps = 0;
  private lineTraceInvalidReason?: string;
  private nextSector = 1;
  private sectorStartTime = 0;
  private sectorTimes: number[] = [];
  private timeTrialRecord: TimeTrialRecord;

  constructor(
    container: HTMLElement,
    hud: HTMLElement,
    setup: RaceSetup,
    mode: SoloSessionMode,
    resolveQualifying?: (result: QualifyingSessionResult) => void,
    resolveTimeTrial?: () => void,
  ) {
    this.container = container;
    this.hud = hud;
    this.setup = setup;
    this.mode = mode;
    this.resolveQualifying = resolveQualifying;
    this.resolveTimeTrial = resolveTimeTrial;
    this.timeTrialRecord = loadTimeTrialRecord(window.localStorage, setup.trackId);

    const start = sampleTrack(START_PROGRESS);
    const approachSpeed = qualifyingApproachSpeed(
      setup.trackId,
      this.tire.grip,
    );
    this.vehicle = {
      ...createVehicle(start.x, start.y, start.heading),
      speed: approachSpeed,
    };
    this.physics = new RapierRacePhysics(this.vehicle, []);
    this.physics.setPlayerState(this.vehicle);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.setupWorld();
    this.scene.add(this.car.root);
    this.bindInput();
    this.resize();
    window.addEventListener('resize', this.resize);
    this.audio.unlock();
    this.syncVisuals(true);
    this.frameId = requestAnimationFrame(this.frame);
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
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.container.addEventListener('pointerdown', this.onPointerDown, { passive: true });
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.audio.unlock();
    this.keys.add(event.code);
    if (this.mode === 'TIME_TRIAL' && event.code === 'Enter') {
      this.finishTimeTrial();
      return;
    }
    if (this.phase === 'RESULTS' && event.code === 'Enter') this.finish();
    if (event.code === 'KeyC' && (this.phase === 'APPROACH' || this.phase === 'FLYING')) this.recover();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
  };

  private readonly onPointerDown = (): void => {
    this.audio.unlock();
  };

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
    this.lapNoticeRemaining = Math.max(0, this.lapNoticeRemaining - dt);
    if (this.lapNoticeRemaining === 0) this.lapNotice = '';

    if (this.phase !== 'RESULTS') {
      this.fixedAccumulator += dt;
      while (this.fixedAccumulator >= FIXED_DT) {
        this.step(FIXED_DT);
        this.fixedAccumulator -= FIXED_DT;
      }
    } else {
      this.resultHold += dt;
      if (this.resultHold >= RESULT_HOLD_SECONDS) {
        this.finish();
        return;
      }
    }

    this.syncVisuals(false);
    this.updateCamera(dt);
    this.updateAudio(dt);
    this.renderHud();
    this.renderer.render(this.scene, this.camera);
    this.frameId = requestAnimationFrame(this.frame);
  };

  private step(dt: number): void {
    if (this.phase === 'COUNTDOWN') {
      this.countdown = Math.max(0, this.countdown - dt);
      this.physics.stopPlayer();
      if (this.countdown === 0) {
        const start = sampleTrack(START_PROGRESS);
        this.vehicle = {
          ...createVehicle(start.x, start.y, start.heading),
          speed: qualifyingApproachSpeed(this.setup.trackId, this.tire.grip),
        };
        this.physics.setPlayerState(this.vehicle);
        this.phase = 'APPROACH';
      }
      return;
    }

    const throttle = this.keys.has('KeyW') ? 1 : 0;
    const brake = this.keys.has('KeyS') ? 1 : 0;
    const rawSteer = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    this.steerInput = stepSteering(this.steerInput, rawSteer, this.vehicle.speed, dt);

    const before = projectTrack(this.vehicle.x, this.vehicle.y);
    const surface = surfaceEffect(before.distance);
    const speedLoad = Math.min(1, this.vehicle.speed / 112);
    const load = Math.min(1.34,
      Math.abs(this.steerInput) * speedLoad * 0.92
      + brake * speedLoad * 0.82
      + throttle * 0.13
      + surface.severity * 0.7,
    );
    this.tire = stepTire(this.tire, 'PUSH', load, dt);

    if (this.phase === 'FLYING') this.paceEvidence.sample(before.distance, 0, false);

    this.physics.drivePlayer({
      throttle,
      brake,
      steer: this.steerInput,
      tireGrip: this.tire.grip,
      tireWear: this.tire.wear,
      surfaceGrip: surface.gripMultiplier,
      powerBoost: CORE_POWER_BOOST,
      powerMultiplier: surface.powerMultiplier,
      rollingResistance: surface.rollingResistance,
    }, dt);
    this.physics.step(dt);
    this.vehicle = this.physics.playerState();
    const playerContact = this.physics.playerContactKind();
    if (this.phase === 'FLYING' && playerContact !== 'NONE') {
      this.lineCandidate.markIneligible();
      this.lineTraceInvalidReason = playerContact === 'BARRIER'
        ? 'WALL CONTACT'
        : 'CAR CONTACT';
      this.lapNotice = playerContact === 'BARRIER'
        ? 'LINE TRACE INVALID · WALL CONTACT'
        : 'LINE TRACE INVALID · CAR CONTACT';
      this.lapNoticeRemaining = 2.2;
    }

    const after = projectTrack(this.vehicle.x, this.vehicle.y);
    this.lastProgress = this.currentProgress;
    this.currentProgress = after.progress;
    const crossedStart = crossedStartLine(this.lastProgress, this.currentProgress);

    if (this.phase === 'APPROACH') {
      if (crossedStart) {
        this.phase = 'FLYING';
        this.lapTime = 0;
        this.nextCheckpoint = 1;
        this.nextSector = 1;
        this.sectorStartTime = 0;
        this.sectorTimes = [];
        this.paceEvidence.begin(this.tire.compound, this.tire.wear);
        this.lapValidity.reset();
        this.lineTraceInvalidReason = undefined;
        this.lineCandidate.begin(this.setup.trackId, this.tire.grip);
      }
      return;
    }

    const validityEvent = this.lapValidity.sample(
      after.laneOffset,
      after.heading,
      this.vehicle.heading,
    );
    this.lineCandidate.sample(
      after.progress,
      after.laneOffset,
      this.vehicle.speed,
      wrapAngle(this.vehicle.heading - after.heading),
      this.vehicle.yawRate,
      dt,
      this.tire.grip,
      this.physics.playerLongitudinalAcceleration(),
    );
    if (validityEvent !== 'NONE') {
      this.lineCandidate.markIneligible();
      this.lineTraceInvalidReason = 'TRACK LIMITS';
      const snapshot = this.lapValidity.snapshot();
      this.lapNotice = snapshot.invalid
        ? 'LAP INVALID · TRACK LIMITS'
        : `TRACK LIMITS WARNING ${snapshot.warnings}/3`;
      this.lapNoticeRemaining = 2.2;
    }

    this.lapTime += dt;
    while (this.nextSector <= 2) {
      const threshold = SOLO_SECTOR_BOUNDARIES[this.nextSector - 1];
      if (this.lastProgress < threshold && this.currentProgress >= threshold) {
        const sectorTime = this.lapTime - this.sectorStartTime;
        this.sectorTimes.push(sectorTime);
        this.sectorStartTime = this.lapTime;
        this.nextSector += 1;
      } else {
        break;
      }
    }

    const thresholds = [0, 0.24, 0.49, 0.74];
    if (this.nextCheckpoint <= 3 && this.currentProgress >= thresholds[this.nextCheckpoint]) {
      this.nextCheckpoint += 1;
    }

    if (crossedStart && this.nextCheckpoint === 4 && this.lapTime > 20) {
      if (this.lapValidity.invalid) this.restartInvalidFlyingLap();
      else this.completeLap();
    }
  }

  private restartInvalidFlyingLap(): void {
    this.lapTime = 0;
    this.nextCheckpoint = 1;
    this.nextSector = 1;
    this.sectorStartTime = 0;
    this.sectorTimes = [];
    this.paceEvidence.begin(this.tire.compound, this.tire.wear);
    this.lapValidity.reset();
    this.lineTraceInvalidReason = undefined;
    this.lineCandidate.begin(this.setup.trackId, this.tire.grip);
    this.lapNotice = 'LAP INVALID · NEXT LAP STARTED';
    this.lapNoticeRemaining = 2.8;
  }

  private completeLap(): void {
    const completedLapTime = this.lapTime;
    const validity = this.lapValidity.snapshot();
    const candidate = validity.candidateEligible
      ? this.lineCandidate.finish(completedLapTime)
      : undefined;

    let storedCandidate = loadPlayerRacingLineCandidate(
      window.localStorage,
      this.setup.trackId,
    );
    if (candidate) {
      storedCandidate = saveBestPlayerRacingLineCandidate(
        window.localStorage,
        candidate,
      );
      console.info('RACING_LINE_CANDIDATE', {
        trackId: storedCandidate.trackId,
        source: storedCandidate.source,
        lapSeconds: storedCandidate.lapSeconds,
        points: storedCandidate.points.length,
        session: this.mode,
      });
    }

    if (this.mode === 'TIME_TRIAL') {
      this.completedLaps += 1;
      const s1 = this.sectorTimes[0];
      const s2 = this.sectorTimes[1];
      const s3 = s1 !== undefined && s2 !== undefined
        ? Math.max(0, completedLapTime - s1 - s2)
        : undefined;
      if (
        validity.candidateEligible
        && s1 !== undefined
        && s2 !== undefined
        && s3 !== undefined
      ) {
        this.timeTrialRecord = saveTimeTrialLap(
          window.localStorage,
          this.setup.trackId,
          completedLapTime,
          [s1, s2, s3],
        );
      }
      const savedThisLap = candidate !== undefined && storedCandidate === candidate;
      const bestSeconds = storedCandidate?.lapSeconds;
      const pb = this.timeTrialRecord.bestLap;
      this.lapNotice = savedThisLap
        ? `PLAYER LINE UPDATED · ${completedLapTime.toFixed(3)}s`
        : candidate
          ? `CLEAN LAP · PB ${pb?.toFixed(3) ?? '—'}s · LINE BEST ${bestSeconds?.toFixed(3) ?? '—'}s`
          : `LAP NOT RECORDED · ${this.lineTraceInvalidReason ?? 'INVALID TRACE'}`;
      this.lapNoticeRemaining = 3.0;

      // Stay on track and start the next hot lap immediately. Keeping the tyre
      // state continuous avoids an artificial grip discontinuity at the timing
      // line while still recording the exact pointwise grip trace each lap.
      this.lapTime = 0;
      this.nextCheckpoint = 1;
      this.nextSector = 1;
      this.sectorStartTime = 0;
      this.sectorTimes = [];
      this.paceEvidence.begin(this.tire.compound, this.tire.wear);
      this.lapValidity.reset();
      this.lineTraceInvalidReason = undefined;
      this.lineCandidate.begin(this.setup.trackId, this.tire.grip);
      return;
    }

    this.physics.stopPlayer();
    this.vehicle = this.physics.playerState();

    const evidence = this.paceEvidence.finish(
      this.setup.trackId,
      completedLapTime,
      this.tire.wear,
    );
    const storedEvidence = savePaceEvidence(window.localStorage, evidence);
    const physicsBenchmark = qualifyingBenchmarkSeconds(
      this.setup.trackId,
      TRACK_LENGTH,
    );
    const calibratedBenchmark = calibratedPaceBenchmark(
      this.setup.trackId,
      physicsBenchmark,
      storedEvidence,
    );
    const assessment = assessEmpiricalLap(evidence);
    console.info('PACE_BENCHMARK_EVIDENCE', {
      lap: evidence,
      eligible: assessment.eligibleForMachineLimit,
      rejectionReasons: assessment.reasons,
      benchmark: calibratedBenchmark,
    });

    const ai = createAiField();
    const classification = qualifyingClassification(
      completedLapTime,
      ai,
      this.setup.trackId,
      TRACK_LENGTH,
    );
    const playerPosition = classification.find(
      (entry) => entry.id === 'player',
    )?.position ?? 8;
    this.result = {
      playerTime: completedLapTime,
      playerPosition,
      gridOrder: qualifyingGridOrder(classification),
      classification,
    };
    this.phase = 'RESULTS';
    this.resultHold = 0;
  }

  private recover(): void {
    if (this.phase === 'FLYING') {
      this.paceEvidence.markRecovered();
      this.lapValidity.invalidate();
      this.lineCandidate.markIneligible();
      this.lineTraceInvalidReason = 'RECOVERY';
      this.lapNotice = 'LAP INVALID · RECOVERY';
      this.lapNoticeRemaining = 2.8;
    }
    const projection = projectTrack(this.vehicle.x, this.vehicle.y);
    const p = sampleTrack(projection.progress);
    this.vehicle = createVehicle(p.x, p.y, p.heading);
    this.physics.setPlayerState(this.vehicle);
    this.steerInput = 0;
  }

  private syncVisuals(initial: boolean): void {
    const position = toWorld(this.vehicle.x, this.vehicle.y, 0.08);
    this.car.root.position.copy(position);
    this.car.root.rotation.y = headingToYaw(this.vehicle.heading);
    this.car.root.rotation.z = -this.steerInput * Math.min(0.045, this.vehicle.speed / 2300);
    if (initial) {
      this.cameraTarget.copy(position);
      this.camera.position.copy(position).add(CAMERA_OFFSET);
      this.camera.lookAt(this.cameraTarget);
    }
  }

  private updateCamera(dt: number): void {
    const position = toWorld(this.vehicle.x, this.vehicle.y, 0.25);
    const desired = position.clone().add(CAMERA_OFFSET);
    this.cameraTarget.lerp(position, 1 - Math.exp(-dt * 4.4));
    this.camera.position.lerp(desired, 1 - Math.exp(-dt * 4.0));
    this.camera.lookAt(this.cameraTarget);
  }

  private updateAudio(dt: number): void {
    const surface = surfaceEffect(projectTrack(this.vehicle.x, this.vehicle.y).distance);
    this.audio.update({
      speed: this.vehicle.speed,
      throttle: this.phase === 'APPROACH' || this.phase === 'FLYING' ? (this.keys.has('KeyW') ? 1 : 0) : 0,
      brake: this.keys.has('KeyS') ? 1 : 0,
      steer: this.steerInput,
      tireGrip: this.tire.grip,
      slideSeverity: this.physics.playerSlideSeverity(),
      surfaceSeverity: surface.severity,
      trafficPressure: 0,
      pitService: false,
      banner: this.phase === 'COUNTDOWN' ? String(Math.max(1, Math.ceil(this.countdown))) : undefined,
    }, dt);
  }

  private renderHud(): void {
    if (this.phase === 'RESULTS' && this.result) {
      const pole = this.result.classification[0]?.time ?? this.result.playerTime;
      const rows = this.result.classification.map((entry) => {
        const delta = entry.position === 1 ? 'POLE' : `+${(entry.time - pole).toFixed(3)}`;
        return `<div class="qualifying-result-row ${entry.isPlayer ? 'you' : ''}"><i>P${entry.position}</i><b>${entry.name}</b><strong>${formatLapTime(entry.time)}</strong><span>${delta}</span></div>`;
      }).join('');
      this.hud.innerHTML = `<div class="qualifying-results">
        <header><small>QUALIFYING COMPLETE</small><h2>P${this.result.playerPosition} · ${formatLapTime(this.result.playerTime)}</h2><p>Grid set for the race.</p></header>
        <div class="qualifying-result-list">${rows}</div>
        <footer>RACE STARTING · PRESS ENTER TO CONTINUE</footer>
      </div>`;
      return;
    }

    const isTimeTrial = this.mode === 'TIME_TRIAL';
    const storedLine = isTimeTrial
      ? loadPlayerRacingLineCandidate(window.localStorage, this.setup.trackId)
      : undefined;
    const lineBest = storedLine?.lapSeconds;
    const ttRecord = isTimeTrial ? this.timeTrialRecord : undefined;
    const historicalSectors = ttRecord?.bestSectors ?? [undefined, undefined, undefined];
    const idealLap = historicalSectors.every((value) => value !== undefined)
      ? historicalSectors.reduce((sum, value) => sum + (value ?? 0), 0)
      : undefined;
    const countdownBanner = this.phase === 'COUNTDOWN'
      ? `<div class="race-banner">${Math.max(1, Math.ceil(this.countdown))}</div>`
      : this.phase === 'APPROACH'
        ? `<div class="qualifying-banner">${isTimeTrial ? 'TIME TRIAL · WARM-UP · TIMER STARTS AT LINE' : 'ROLLING START · TAKE CONTROL · TIMER STARTS AT LINE'}</div>`
        : '';
    const limitBanner = this.lapNotice
      ? `<div class="qualifying-banner">${this.lapNotice}</div>`
      : '';
    const timer = this.phase === 'FLYING'
      ? formatLapTime(this.lapTime)
      : '--:--.---';
    const speed = Math.round(this.vehicle.speed * 3.6);
    const state = this.phase === 'FLYING'
      ? isTimeTrial
        ? `HOT LAP ${this.completedLaps + 1}`
        : 'FLYING LAP'
      : this.phase === 'APPROACH'
        ? 'APPROACH'
        : 'GET READY';
    const sessionLabel = isTimeTrial
      ? 'PITWALL RACER · TIME TRIAL / LINE UPDATE'
      : 'PITWALL RACER · QUALIFYING';
    const runLabel = isTimeTrial
      ? `CONTINUOUS HOTLAP · SOFT/PUSH · LINE BEST ${lineBest?.toFixed(3) ?? '—'}s`
      : 'ONE SHOT · SOFT';
    const controls = isTimeTrial
      ? 'WASD DRIVE · C RECOVER · ENTER RETURN MENU'
      : 'WASD DRIVE · C RECOVER';
    const currentSectorTimes = [
      this.sectorTimes[0] ?? (this.nextSector === 1 && this.phase === 'FLYING'
        ? this.lapTime - this.sectorStartTime
        : undefined),
      this.sectorTimes[1] ?? (this.nextSector === 2 && this.phase === 'FLYING'
        ? this.lapTime - this.sectorStartTime
        : undefined),
      this.nextSector === 3 && this.phase === 'FLYING'
        ? this.lapTime - this.sectorStartTime
        : undefined,
    ];
    const historicalSectorHtml = isTimeTrial
      ? historicalSectors.map((best, index) => {
          const current = currentSectorTimes[index];
          const delta = current !== undefined && best !== undefined
            ? current - best
            : undefined;
          const deltaText = delta === undefined
            ? '—'
            : `${delta >= 0 ? '+' : ''}${delta.toFixed(3)}`;
          return `<div><small>S${index + 1} ALL-TIME</small><b>${formatShortTime(best)}</b><span>${current === undefined ? 'TARGET' : `LIVE ${formatShortTime(current)} · ${deltaText}`}</span></div>`;
        }).join('')
      : '';
    const historyHtml = isTimeTrial
      ? ttRecord?.laps.slice(0, 5).map((lap, index) =>
          `<span><i>#${index + 1}</i><b>${formatLapTime(lap.lapTime)}</b><small>${lap.sectors.map((s) => s.toFixed(3)).join(' · ')}</small></span>`,
        ).join('') ?? ''
      : '';

    this.hud.innerHTML = `${countdownBanner}${limitBanner}
      <div class="qualifying-hud-top">
        <div><small>${sessionLabel}</small><b>${getActiveTrack().name}</b></div>
        <strong>${timer}</strong>
      </div>
      ${isTimeTrial ? `<div style="position:absolute;right:24px;top:96px;width:min(520px,calc(100vw - 48px));padding:12px 14px;background:rgba(4,10,12,.92);border:1px solid rgba(255,255,255,.16);color:#e7f0ed;font:12px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace">
        <div style="display:flex;justify-content:space-between;gap:14px;border-bottom:1px solid rgba(255,255,255,.12);padding-bottom:8px;margin-bottom:8px"><b>ALL-TIME PB · ${formatLapTime(ttRecord?.bestLap)}</b><span>IDEAL · ${formatLapTime(idealLap)}</span></div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">${historicalSectorHtml}</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.12)">${historyHtml || '<span><b>NO VALID LAPS YET</b></span>'}</div>
      </div>` : ''}
      <div class="qualifying-hud-bottom">
        <div class="speedo"><strong>${speed}</strong><span>KM/H</span></div>
        <div><small>${state}</small><b>${runLabel}</b><span>${controls}</span></div>
      </div>`;
  }

  private finish(): void {
    if (this.resolved || !this.result || !this.resolveQualifying) return;
    const result = this.result;
    this.disposeSession();
    this.resolveQualifying(result);
  }

  private finishTimeTrial(): void {
    if (this.resolved || this.mode !== 'TIME_TRIAL' || !this.resolveTimeTrial) {
      return;
    }
    const resolve = this.resolveTimeTrial;
    this.disposeSession();
    resolve();
  }

  private disposeSession(): void {
    this.resolved = true;
    cancelAnimationFrame(this.frameId);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.container.removeEventListener('pointerdown', this.onPointerDown);
    this.audio.reset();
    this.renderer.dispose();
    this.container.innerHTML = '';
    this.hud.innerHTML = '';
  }
}


function qualifyingApproachSpeed(trackId: RaceSetup['trackId'], tireGrip: number): number {
  const reference = referenceTarget(trackId, START_PROGRESS, tireGrip);
  return clamp(reference.targetSpeed * 0.96, 56, 76);
}

function wrapAngle(angle: number): number {
  let result = angle;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatShortTime(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—';
  return seconds.toFixed(3);
}
