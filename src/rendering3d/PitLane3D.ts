import * as THREE from 'three';
import {
  PIT_LIMIT_END_T,
  PIT_LIMIT_START_T,
  pitBoxTForSlot,
  pitLanePose,
} from '../simulation/PitLaneModel';
import { headingToYaw, toWorld } from './WorldTransform';

const SAMPLES = 128;
export const PIT_LANE_HALF_WIDTH = 7.5;
const EDGE_LINE_WIDTH = 0.45;
const BOX_COLORS = [
  0x31b9ef,
  0xe64c4c,
  0xe8e8e5,
  0x54cf88,
  0x9f72e6,
  0xf3a341,
  0x5d8fe8,
  0xf064ad,
];

export function createPitLane3D(): THREE.Group {
  const root = new THREE.Group();
  const road = new THREE.Mesh(
    pitRibbonGeometry(-PIT_LANE_HALF_WIDTH, PIT_LANE_HALF_WIDTH, 0.04),
    new THREE.MeshStandardMaterial({
      color: 0x34383b,
      roughness: 0.9,
      metalness: 0.02,
    }),
  );
  road.receiveShadow = true;
  root.add(road);

  const lineMat = new THREE.MeshStandardMaterial({
    color: 0xf0f2ed,
    roughness: 0.78,
  });
  for (const side of [-1, 1] as const) {
    const center = side * (PIT_LANE_HALF_WIDTH - 0.32);
    const edge = new THREE.Mesh(
      pitRibbonGeometry(
        center - EDGE_LINE_WIDTH / 2,
        center + EDGE_LINE_WIDTH / 2,
        0.067,
      ),
      lineMat,
    );
    edge.receiveShadow = true;
    root.add(edge);
  }

  addPitWall(root);
  addPitBoxes(root);
  addLimiterLine(root, PIT_LIMIT_START_T, 0x58f59a);
  addLimiterLine(root, PIT_LIMIT_END_T, 0xffd166);
  return root;
}

function addPitBoxes(root: THREE.Group): void {
  for (let slot = 0; slot < 8; slot++) {
    const pose = pitLanePose(pitBoxTForSlot(slot));
    const world = toWorld(pose.x, pose.y, 0.075);
    const outline = new THREE.Mesh(
      new THREE.BoxGeometry(4.8, 0.028, 2.25),
      new THREE.MeshStandardMaterial({
        color: 0xf1f2ed,
        roughness: 0.72,
      }),
    );
    outline.position.copy(world);
    outline.rotation.y = headingToYaw(pose.heading);
    root.add(outline);

    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.04, 1.55),
      new THREE.MeshStandardMaterial({
        color: BOX_COLORS[slot] ?? 0xffffff,
        roughness: 0.62,
      }),
    );
    marker.position.copy(world).add(new THREE.Vector3(0, 0.035, 0));
    marker.rotation.y = outline.rotation.y;
    root.add(marker);
  }
}

function addLimiterLine(
  root: THREE.Group,
  t: number,
  color: number,
): void {
  const pose = pitLanePose(t);
  const world = toWorld(pose.x, pose.y, 0.08);
  const line = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.035, PIT_LANE_HALF_WIDTH * 2),
    new THREE.MeshStandardMaterial({ color, roughness: 0.65 }),
  );
  line.position.copy(world);
  line.rotation.y = headingToYaw(pose.heading);
  root.add(line);
}

function addPitWall(root: THREE.Group): void {
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xcfd3d1,
    roughness: 0.78,
  });
  const segments = 22;
  const geometry = new THREE.BoxGeometry(5.1, 0.48, 0.2);
  for (let i = 0; i < segments; i++) {
    const t = 0.13 + (i + 0.5) / segments * 0.74;
    const pose = pitLanePose(t);
    const point = offsetPose(pose, PIT_LANE_HALF_WIDTH + 1.6);
    const barrier = new THREE.Mesh(geometry, wallMat);
    barrier.position.copy(toWorld(point.x, point.y, 0.25));
    barrier.rotation.y = headingToYaw(pose.heading);
    barrier.castShadow = true;
    barrier.receiveShadow = true;
    root.add(barrier);
  }
}

export function pitRibbonGeometry(
  offsetA: number,
  offsetB: number,
  height: number,
): THREE.BufferGeometry {
  const leftOffset = Math.max(offsetA, offsetB);
  const rightOffset = Math.min(offsetA, offsetB);
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const pose = pitLanePose(t);
    const left = offsetPose(pose, leftOffset);
    const right = offsetPose(pose, rightOffset);
    const lw = toWorld(left.x, left.y, height);
    const rw = toWorld(right.x, right.y, height);
    vertices.push(lw.x, lw.y, lw.z, rw.x, rw.y, rw.z);
    if (i < SAMPLES) {
      const i0 = i * 2;
      const i1 = i0 + 1;
      const i2 = i0 + 2;
      const i3 = i0 + 3;
      indices.push(i0, i2, i1, i1, i2, i3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function offsetPose(
  pose: { x: number; y: number; heading: number },
  offset: number,
): { x: number; y: number } {
  return {
    x: pose.x - Math.sin(pose.heading) * offset,
    y: pose.y + Math.cos(pose.heading) * offset,
  };
}
