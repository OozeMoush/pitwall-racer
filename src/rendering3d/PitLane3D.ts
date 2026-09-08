import * as THREE from 'three';
import { PIT_BOX_T, pitLanePose } from '../simulation/PitLaneModel';
import { headingToYaw, toWorld } from './WorldTransform';

const SAMPLES = 72;
const HALF_WIDTH = 20;

export function createPitLane3D(): THREE.Group {
  const root = new THREE.Group();
  const road = new THREE.Mesh(
    pitRibbonGeometry(),
    new THREE.MeshStandardMaterial({ color: 0x34383b, roughness: 0.9, metalness: 0.02 }),
  );
  road.receiveShadow = true;
  root.add(road);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xcfd3d1, roughness: 0.78 });
  for (let i = 8; i < SAMPLES - 8; i += 4) {
    const pose = pitLanePose(i / SAMPLES);
    const point = offsetPose(pose, 28);
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.42, 0.16), wallMat);
    barrier.position.copy(toWorld(point.x, point.y, 0.23));
    barrier.rotation.y = headingToYaw(pose.heading);
    barrier.castShadow = true;
    barrier.receiveShadow = true;
    root.add(barrier);
  }

  const boxPose = pitLanePose(PIT_BOX_T);
  const boxWorld = toWorld(boxPose.x, boxPose.y, 0.075);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xf1f2ed, roughness: 0.72 });
  const pitBox = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.025, 1.65), boxMat);
  pitBox.position.copy(boxWorld);
  pitBox.rotation.y = headingToYaw(boxPose.heading);
  root.add(pitBox);

  const centre = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.03, 1.1),
    new THREE.MeshStandardMaterial({ color: 0xe84c50, roughness: 0.65 }),
  );
  centre.position.copy(boxWorld).add(new THREE.Vector3(0, 0.03, 0));
  centre.rotation.y = pitBox.rotation.y;
  root.add(centre);

  return root;
}

function pitRibbonGeometry(): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const pose = pitLanePose(t);
    const left = offsetPose(pose, HALF_WIDTH);
    const right = offsetPose(pose, -HALF_WIDTH);
    const lw = toWorld(left.x, left.y, 0.04);
    const rw = toWorld(right.x, right.y, 0.04);
    vertices.push(lw.x, lw.y, lw.z, rw.x, rw.y, rw.z);
    if (i < SAMPLES) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function offsetPose(pose: { x: number; y: number; heading: number }, offset: number): { x: number; y: number } {
  return {
    x: pose.x - Math.sin(pose.heading) * offset,
    y: pose.y + Math.cos(pose.heading) * offset,
  };
}
