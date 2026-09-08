import * as THREE from 'three';
import { sampleTrack } from '../simulation/TrackModel';

// Render scale is intentionally larger than the first 3D prototype. The car is
// now smaller as well, so a 300-350 km/h run covers several visible car lengths
// per second instead of looking like a slow tabletop crawl.
export const WORLD_SCALE = 0.15;
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
