import * as THREE from 'three';
import { PIT_BOX_T, pitLanePose } from '../simulation/PitLaneModel';
import { headingToYaw, toWorld } from './WorldTransform';

const SAMPLES = 96;
const HALF_WIDTH = 20;
const EDGE_LINE_WIDTH = 0.7;

export function createPitLane3D(): THREE.Group {
  const root = new THREE.Group();
  const road = new THREE.Mesh(
    pitRibbonGeometry(-HALF_WIDTH, HALF_WIDTH, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x34383b, roughness: 0.9, metalness: 0.02 }),
  );
  road.receiveShadow = true;
  root.add(road);

  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf0f2ed, roughness: 0.78 });
  for (const side of [-1, 1] as const) {
    const center = side * (HALF_WIDTH - 0.45);
    const edge = new THREE.Mesh(
      pitRibbonGeometry(center - EDGE_LINE_WIDTH / 2, center + EDGE_LINE_WIDTH / 2, 0.067),
      lineMat,
    );
    edge.receiveShadow = true;
    root.add(edge);
  }

  addPitWall(root);

  const boxPose = pitLanePose(PIT_BOX_T);
  const boxWorld = toWorld(boxPose.x, boxPose.y, 0.075);
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xf1f2ed, roughness: 0.72 });
  const pitBox = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.028, 1.9), boxMat);
  pitBox.position.copy(boxWorld);
  pitBox.rotation.y = headingToYaw(boxPose.heading);
  root.add(pitBox);

  const centre = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.035, 1.25),
    new THREE.MeshStandardMaterial({ color: 0xe84c50, roughness: 0.65 }),
  );
  centre.position.copy(boxWorld).add(new THREE.Vector3(0, 0.03, 0));
  centre.rotation.y = pitBox.rotation.y;
  root.add(centre);

  return root;
}

function addPitWall(root: THREE.Group): void {
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xcfd3d1, roughness: 0.78 });
  const segments = 16;
  const geometry = new THREE.BoxGeometry(6.8, 0.48, 0.2);
  for (let i = 0; i < segments; i++) {
    const t = 0.13 + (i + 0.5) / segments * 0.74;
    const pose = pitLanePose(t);
    const point = offsetPose(pose, 28);
    const barrier = new THREE.Mesh(geometry, wallMat);
    barrier.position.copy(toWorld(point.x, point.y, 0.25));
    barrier.rotation.y = headingToYaw(pose.heading);
    barrier.castShadow = true;
    barrier.receiveShadow = true;
    root.add(barrier);
  }
}

function pitRibbonGeometry(offsetA: number, offsetB: number, height: number): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const pose = pitLanePose(t);
    const a = offsetPose(pose, offsetA);
    const b = offsetPose(pose, offsetB);
    const aw = toWorld(a.x, a.y, height);
    const bw = toWorld(b.x, b.y, height);
    vertices.push(aw.x, aw.y, aw.z, bw.x, bw.y, bw.z);
    if (i < SAMPLES) {
      const i0 = i * 2;
      const i1 = i0 + 1;
      const i2 = i0 + 2;
      const i3 = i0 + 3;
      indices.push(i0, i2, i1, i1, i2, i3);
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
