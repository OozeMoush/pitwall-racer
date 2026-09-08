import * as THREE from 'three';
import { sampleTrack } from '../simulation/TrackModel';

// The fixed isometric camera follows position but not heading, so apparent
// speed comes mostly from how quickly track detail crosses the viewport. Keep
// the simulation in metre-ish units and deliberately enlarge the rendered
// world instead of faking the HUD speed.
export const WORLD_SCALE = 0.22;
export const WORLD_CENTER_X = 1110;
export const WORLD_CENTER_Y = 600;

export function toWorld(x: number, y: number, height = 0): THREE.Vector3 {
  return new THREE.Vector3(
    (x - WORLD_CENTER_X) * WORLD_SCALE,
    height,
    (y - WORLD_CENTER_Y) * WORLD_SCALE,
  );
}

export function trackWorld(progress: number, laneOffset = 0, height = 0): THREE.Vector3 {
  const p = sampleTrack(progress, laneOffset);
  return toWorld(p.x, p.y, height);
}

export function headingToYaw(heading: number): number {
  return -heading;
}

export function headingVector(heading: number): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
}
