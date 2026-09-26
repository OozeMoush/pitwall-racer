import * as THREE from 'three';
import { createPitLane3D } from './PitLane3D';
import { createTrack3D } from './Track3D';
import { toWorld } from './WorldTransform';

const CAMERA_HALF_HEIGHT = 19.5;
const CAMERA_OFFSET = new THREE.Vector3(18.5, 34, 18.5);

export function createRaceCamera(): THREE.OrthographicCamera {
  return new THREE.OrthographicCamera(
    -40,
    40,
    CAMERA_HALF_HEIGHT,
    -CAMERA_HALF_HEIGHT,
    0.1,
    460,
  );
}

export function setupRaceWorld(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x8baab2);
  scene.fog = new THREE.Fog(0x8baab2, 165, 450);
  scene.add(new THREE.HemisphereLight(0xdceef3, 0x29402d, 1.45));

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
  scene.add(sun);

  scene.add(createTrack3D());
  scene.add(createPitLane3D());
}

export function resizeRaceViewport(
  container: HTMLElement,
  renderer: THREE.WebGLRenderer,
  camera: THREE.OrthographicCamera,
): void {
  const width = Math.max(1, container.clientWidth);
  const height = Math.max(1, container.clientHeight);
  const aspect = width / height;
  renderer.setSize(width, height, false);
  camera.left = -CAMERA_HALF_HEIGHT * aspect;
  camera.right = CAMERA_HALF_HEIGHT * aspect;
  camera.top = CAMERA_HALF_HEIGHT;
  camera.bottom = -CAMERA_HALF_HEIGHT;
  camera.updateProjectionMatrix();
}

export function snapRaceCamera(
  camera: THREE.OrthographicCamera,
  target: THREE.Vector3,
  x: number,
  y: number,
): void {
  const position = toWorld(x, y, 0.08);
  target.copy(position);
  camera.position.copy(position).add(CAMERA_OFFSET);
  camera.lookAt(target);
}

export function followRaceCamera(
  camera: THREE.OrthographicCamera,
  target: THREE.Vector3,
  x: number,
  y: number,
  dt: number,
): void {
  const position = toWorld(x, y, 0.25);
  const desired = position.clone().add(CAMERA_OFFSET);
  target.lerp(position, 1 - Math.exp(-dt * 4.4));
  camera.position.lerp(desired, 1 - Math.exp(-dt * 4.0));
  camera.lookAt(target);
}
