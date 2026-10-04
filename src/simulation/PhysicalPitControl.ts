import { stepSteering } from './InputModel';
import { pitLanePose, pitLaneTargetSpeed, projectPitLane, type PitStopState } from './PitLaneModel';
import { projectTrack, sampleTrack, TRACK_LENGTH } from './TrackModel';
import type { VehicleState } from './VehicleModel';

const PIT_LOOKAHEAD_T = 0.026;
const PIT_LATERAL_ACCELERATION = 12; // m/s²; shared route-following safety budget

/** Shared pit assist; callers still integrate their real rigid body. */
export function physicalPitControl(
  vehicle: VehicleState, state: PitStopState, previousSteer: number, dt: number,
  rawSteer = 0, requestedThrottle = 1, requestedBrake = 0, approach = false,
) {
  const projection = projectPitLane(vehicle.x, vehicle.y, state.t);
  let approachSteer: number | undefined;
  let target = pitLanePose(Math.min(1, projection.t + PIT_LOOKAHEAD_T));
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
  let targetSpeed = pitLaneTargetSpeed(state, projection.t);
  if (!approach && projection.t + PIT_LOOKAHEAD_T <= 0.90) {
    // Offset pit routes can bend more sharply than the main road. Brake for
    // their actual curvature before the steering assist runs out of authority.
    // The exit merge retains its existing speed target for rejoining traffic.
    const turn = Math.abs(Math.atan2(Math.sin(target.heading - projection.pose.heading),
      Math.cos(target.heading - projection.pose.heading)));
    const chord = Math.hypot(target.x - projection.pose.x, target.y - projection.pose.y);
    if (turn > 0.02) targetSpeed = Math.min(targetSpeed,
      Math.sqrt(PIT_LATERAL_ACCELERATION * Math.max(1, chord) / turn));
  }
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
