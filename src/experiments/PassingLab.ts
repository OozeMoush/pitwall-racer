import RAPIER from '@dimforge/rapier2d-compat';
import { CAR_COLLIDER_HALF_LENGTH, CAR_COLLIDER_HALF_WIDTH, RapierRacePhysics } from '../simulation/RapierRacePhysics';
import { CorridorPassing } from '../simulation/experiments/CorridorPassing';
import { dynamicAiControl } from '../simulation/DynamicAiController';
import { stepSteering } from '../simulation/InputModel';
import { createAiField } from '../simulation/RaceModel';
import { installReferenceLineCalibration } from '../simulation/ReferenceLineCalibration';
import { activeReferenceTarget } from '../simulation/RacingLineRuntime';
import { surfaceEffect } from '../simulation/SurfaceModel';
import { sampleTrack, projectTrackNear, setActiveTrack, TRACK_LENGTH } from '../simulation/TrackModel';
import { hasSafetyBarrier, trackAiSafeLaneLimit, trackBarrierOffset } from '../simulation/TrackLimitsModel';
import { signedHeadingDelta } from '../simulation/TrackProfile';
import { createVehicle, type VehicleState } from '../simulation/VehicleModel';

const canvas = document.querySelector<HTMLCanvasElement>('#lab')!;
const context = canvas.getContext('2d')!;
const status = document.querySelector<HTMLOutputElement>('#status')!;
const start = document.querySelector<HTMLButtonElement>('#start')!;
const reset = document.querySelector<HTMLButtonElement>('#reset')!;
const keys = new Set<string>();
let physics: RapierRacePhysics;
let cpu = createAiField()[1];
let policy = new CorridorPassing();
let playerProgress = 0;
let playerLap = 1;
let steering = 0;
let running = false;
let phase = 'FOLLOW';
let elapsed = 0;
let contactSeconds = 0;
let accumulator = 0;
let lastFrame = performance.now();
let lastHud = 0;
const DT = 1 / 120;
const road: { x: number; y: number }[] = [];
const walls: { x: number; y: number; join: boolean }[] = [];

function restart() {
  physics?.world.free();
  cpu = { ...createAiField()[1], lap: 1, progress: 0.04, laneOffset: 0, pitPlan: [] };
  playerProgress = cpu.progress + 40 / TRACK_LENGTH;
  playerLap = 1;
  const front = sampleTrack(playerProgress), back = sampleTrack(cpu.progress);
  physics = new RapierRacePhysics(createVehicle(front.x, front.y, front.heading), [cpu]);
  physics.setPlayerState({ ...createVehicle(front.x, front.y, front.heading), speed: 65 });
  physics.setAiState(0, { ...createVehicle(back.x, back.y, back.heading), speed: 75 });
  policy = new CorridorPassing();
  elapsed = contactSeconds = accumulator = steering = 0;
  phase = 'FOLLOW';
  keys.clear();
  running = false;
  start.textContent = '開始';
  lastHud = -1;
}
function toggle() {
  running = !running;
  accumulator = 0;
  keys.clear();
  start.textContent = running ? '一時停止' : '再開';
}
function drive() {
  const player = physics.playerState(), car = physics.aiStates()[0];
  const rp = projectTrackNear(player.x, player.y, playerProgress);
  const rc = projectTrackNear(car.x, car.y, cpu.progress);
  if (playerProgress > 0.88 && rp.progress < 0.12) playerLap++;
  if (cpu.progress > 0.88 && rc.progress < 0.12) cpu.lap++;
  playerProgress = rp.progress;
  cpu.progress = rc.progress; cpu.laneOffset = rc.laneOffset; cpu.speed = car.speed;
  const traffic = [{ id: 'lab-player', lap: playerLap, progress: rp.progress,
    laneOffset: rp.laneOffset, speed: player.speed, performance: 1, isPlayer: true }];
  const base = dynamicAiControl(cpu, car, traffic);
  const reference = activeReferenceTarget('pitwall-gp', cpu.progress, cpu.tire.grip);
  const gap = ((playerLap - cpu.lap) + rp.progress - cpu.progress) * TRACK_LENGTH;
  const plan = policy.step({ dt: DT, gap, speed: car.speed, opponentSpeed: player.speed,
    lane: rc.laneOffset, opponentLane: rp.laneOffset, referenceLane: reference.laneOffset,
    safeLane: Math.min(...[0, 30, 60, 90, 120].map(m => trackAiSafeLaneLimit(cpu.progress + m / TRACK_LENGTH))),
    straight: Math.abs(signedHeadingDelta(cpu.progress, cpu.progress + 120 / TRACK_LENGTH)) < 0.12 }, car, cpu.progress, cpu.tire.grip);
  phase = plan.phase;
  const experimental = phase !== 'FOLLOW' || plan.speed < base.targetSpeed;
  const cpuBrake = experimental ? Math.max(0, Math.min(1, (car.speed - plan.speed) / 8)) : base.brake;
  const cpuThrottle = experimental ? (car.speed < plan.speed ? 1 : 0) : base.throttle;
  const input = (distance: number) => {
    const s = surfaceEffect(distance);
    return { tireGrip: cpu.tire.grip, surfaceGrip: s.gripMultiplier,
      powerBoost: 0.22, powerMultiplier: s.powerMultiplier, rollingResistance: s.rollingResistance };
  };
  steering = stepSteering(steering, Number(keys.has('d')) - Number(keys.has('a')), player.speed, DT);
  physics.drivePlayer({ ...input(rp.distance), throttle: Number(keys.has('w')),
    brake: Number(keys.has('s')), steer: steering }, DT);
  physics.driveAi(0, { ...input(rc.distance), throttle: cpuThrottle, brake: cpuBrake,
    steer: phase === 'FOLLOW' ? base.steer : plan.steer }, DT);
  physics.step(DT);
  let contact = false;
  physics.world.forEachCollider(collider => {
    if (!collider.parent()?.isDynamic()) return;
    physics.world.contactPairsWith(collider, other => physics.world.contactPair(collider, other, manifold => {
      for (let i = 0; i < manifold.numContacts(); i++) if (manifold.contactDist(i) <= 0) contact = true;
    }));
  });
  if (contact) contactSeconds += DT;
  elapsed += DT;
}
function draw() {
  const ratio = devicePixelRatio || 1;
  const width = Math.round(canvas.clientWidth * ratio), height = Math.round(canvas.clientHeight * ratio);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const player = physics.playerState(), car = physics.aiStates()[0];
  const scale = Math.min(width / 300, height / 180);
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.setTransform(scale, 0, 0, scale, width / 2 - player.x * scale, height / 2 - player.y * scale);
  context.beginPath();
  road.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y));
  context.closePath(); context.lineJoin = 'round'; context.strokeStyle = '#53606a'; context.lineWidth = 34; context.stroke();
  context.setLineDash([6, 10]); context.lineWidth = 0.6; context.strokeStyle = '#a1b0b7'; context.stroke(); context.setLineDash([]);
  context.beginPath();
  walls.forEach(p => p.join ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y));
  context.lineWidth = 1.5; context.strokeStyle = '#c7d1d8'; context.stroke();
  const vehicle = (v: VehicleState, color: string) => {
    context.save(); context.translate(v.x, v.y); context.rotate(v.heading);
    context.fillStyle = color; context.fillRect(-CAR_COLLIDER_HALF_LENGTH, -CAR_COLLIDER_HALF_WIDTH, 2 * CAR_COLLIDER_HALF_LENGTH, 2 * CAR_COLLIDER_HALF_WIDTH);
    context.fillStyle = '#15232e'; context.fillRect(1, -1.3, 2.5, 2.6); context.restore();
  };
  vehicle(car, '#ffe181'); vehicle(player, '#78c8ff');
  if (performance.now() - lastHud > 100) {
    const shownPhase: Record<string, string> = { FOLLOW: '追従', COMMIT: '追い抜き開始', ALONGSIDE: '並走', ABORT: '断念', RETURN: 'ラインへ復帰' };
    status.textContent = `${running ? '走行中' : '停止中'} ｜ 自分 ${Math.round(player.speed * 3.6)} km/h ｜ CPU ${Math.round(car.speed * 3.6)} km/h ｜ ${shownPhase[phase]} ｜ ${elapsed.toFixed(1)}秒 ｜ 接触時間 ${contactSeconds.toFixed(2)}秒（壁を含む）`;
    lastHud = performance.now();
  }
}
function frame(now: number) {
  accumulator += running ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  while (accumulator >= DT) { drive(); accumulator -= DT; }
  draw(); requestAnimationFrame(frame);
}
async function initialize() {
  await RAPIER.init(); installReferenceLineCalibration(); setActiveTrack('pitwall-gp');
  for (let i = 0; i < 900; i++) road.push(sampleTrack(i / 900));
  for (const side of [-1, 1] as const) {
    let join = false;
    for (let i = 0; i <= 900; i++) {
      const p = i / 900;
      if (hasSafetyBarrier(p, side)) {
        walls.push({ ...sampleTrack(p, side * trackBarrierOffset(p)), join }); join = true;
      } else join = false;
    }
  }
  restart(); start.disabled = reset.disabled = false;
  start.onclick = toggle; reset.onclick = restart;
  window.addEventListener('keydown', event => {
    const key = event.key.toLowerCase();
    if (!['w', 'a', 's', 'd', 'p', 'r'].includes(key)) return;
    event.preventDefault();
    if (!event.repeat && key === 'p') toggle();
    if (!event.repeat && key === 'r') restart();
    if (running) keys.add(key);
  });
  window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
  window.addEventListener('blur', () => { if (running) toggle(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && running) toggle(); });
  requestAnimationFrame(frame);
}
initialize().catch(error => { status.textContent = `初期化失敗: ${String(error)}`; });
