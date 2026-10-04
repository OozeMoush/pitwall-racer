import { stepSteering } from './InputModel';
import { pitLanePose, pitLaneTargetSpeed, projectPitLane, type PitStopState } from './PitLaneModel';
import { projectTrack, sampleTrack, TRACK_LENGTH } from './TrackModel';
import type { VehicleState } from './VehicleModel';

/** Shared pit assist; callers still integrate their real rigid body. */
export function physicalPitControl(
  vehicle: VehicleState, state: PitStopState, previousSteer: number, dt: number,
  rawSteer = 0, requestedThrottle = 1, requestedBrake = 0, approach = false,
) {
  const projection = projectPitLane(vehicle.x, vehicle.y, state.t);
  let approachSteer: number | undefined;
  let target = pitLanePose(Math.min(1, projection.t + 0.026));
  if (approach) {
    const road = projectTrack(vehicle.x, vehicle.y);
    const entry = pitLanePose(0);
    const gap = ((entry.raceProgress - road.progress + 1) % 1) * TRACK_LENGTH;
    const approachLane = entry.laneOffset + Math.sign(entry.laneOffset) * 4;
    const roadTarget = sampleTrack(road.progress + Math.min(35, gap) / TRACK_LENGTH, approachLane);
    target = { ...entry, x: roadTarget.x, y: roadTarget.y };
    const bearing = Math.atan2(roadTarget.y - vehicle.y, roadTarget.x - vehicle.x);
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    approachSteer = wrap(roadTarget.heading - vehicle.heading) * 2.15
      + wrap(bearing - vehicle.heading) * 0.82
      + clamp((approachLane - road.laneOffset) / 9, -1, 1) * 0.52
      - vehicle.yawRate * 0.38;
  }
  const heading = Math.atan2(target.y - vehicle.y, target.x - vehicle.x);
  const headingError = Math.atan2(Math.sin(heading - vehicle.heading), Math.cos(heading - vehicle.heading));
  const assist = clamp(approachSteer ?? (headingError * 1.55 - projection.lateralOffset * 0.038), -1, 1);
  const steer = stepSteering(previousSteer, clamp(rawSteer * 0.72 + assist * 0.82, -1, 1), vehicle.speed, dt);
  let throttle = requestedThrottle;
  let brake = requestedBrake;
  const targetSpeed = pitLaneTargetSpeed(state, projection.t);
  if (vehicle.speed > targetSpeed) {
    throttle = 0;
    brake = Math.max(brake, Math.min(1, (vehicle.speed - targetSpeed) / 7 + 0.18));
  }
  const speedLoad = Math.min(1, vehicle.speed / 60);
  const tyreLoad = Math.min(1.15, Math.abs(steer) * speedLoad * 0.45
    + brake * speedLoad * 0.55 + throttle * 0.08);
  return { projection, steer, throttle, brake, tyreLoad };
}
function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }
