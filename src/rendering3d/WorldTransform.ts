import * as THREE from 'three';
import { sampleTrack } from '../simulation/TrackModel';

// Keep the fixed GeneRally-style camera readable from a little farther away,
// while scaling the circuit up enough that trackside reference objects still
// sweep across the viewport quickly. The goal is "wide but fast", not zoomed-in
// shimmer.
export const WORLD_SCALE = 0.40;
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
