import * as THREE from 'three';
import { aiGridSlot, PLAYER_GRID } from '../simulation/GridModel';
import { trackProfile } from '../simulation/TrackProfile';
import { sampleTrack } from '../simulation/TrackModel';
import { headingToYaw, toWorld, WORLD_SCALE } from './WorldTransform';

export const ROAD_HALF_WIDTH = 28;
const RUNOFF_HALF_WIDTH = 40;
const SAMPLE_COUNT = 460;

export function createTrack3D(): THREE.Group {
  const root = new THREE.Group();

  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(820, 470, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x23472f, roughness: 1, metalness: 0 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.07;
  grass.receiveShadow = true;
  root.add(grass);

  addRibbon(root, RUNOFF_HALF_WIDTH, 0.004, 0x62686a, 0.98);
  addRibbon(root, ROAD_HALF_WIDTH, 0.032, 0x2d3033, 0.9);
  addRibbon(root, 14.5, 0.043, 0x242729, 0.98);
  addEdgeLines(root);
  addCornerKerbs(root);
  addStartFinish(root);
  addGridBoxes(root);
  addSafetyBarriers(root);
  addPitBuildings(root);
  addGrandstands(root);
  addBrakingBoards(root);
  addSpeedReferencePosts(root);

  return root;
}

function addRibbon(root: THREE.Group, halfWidth: number, height: number, color: number, roughness: number): void {
  const mesh = new THREE.Mesh(
    ribbonGeometry(halfWidth, height),
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 }),
  );
  mesh.receiveShadow = true;
  root.add(mesh);
}

function ribbonGeometry(halfWidth: number, height: number): THREE.BufferGeometry {
  const vertices: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= SAMPLE_COUNT; i++) {
    const p = i / SAMPLE_COUNT;
    const left = sampleTrack(p, halfWidth);
    const right = sampleTrack(p, -halfWidth);
    const lw = toWorld(left.x, left.y, height);
    const rw = toWorld(right.x, right.y, height);
    vertices.push(lw.x, lw.y, lw.z, rw.x, rw.y, rw.z);
    uvs.push(0, p * 36, 1, p * 36);
    if (i < SAMPLE_COUNT) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function offsetRibbonGeometry(offsetA: number, offsetB: number, height: number): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= SAMPLE_COUNT; i++) {
    const progress = i / SAMPLE_COUNT;
    const a = sampleTrack(progress, offsetA);
    const b = sampleTrack(progress, offsetB);
    const aw = toWorld(a.x, a.y, height);
    const bw = toWorld(b.x, b.y, height);
    vertices.push(aw.x, aw.y, aw.z, bw.x, bw.y, bw.z);
    if (i < SAMPLE_COUNT) {
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

function addEdgeLines(root: THREE.Group): void {
  const material = new THREE.MeshStandardMaterial({ color: 0xf2f3ef, roughness: 0.76 });
  for (const side of [-1, 1] as const) {
    const inner = side * (ROAD_HALF_WIDTH - 0.82);
    const outer = side * (ROAD_HALF_WIDTH - 0.18);
    const line = new THREE.Mesh(offsetRibbonGeometry(inner, outer, 0.073), material);
    line.receiveShadow = true;
    root.add(line);
  }
}

function addCornerKerbs(root: THREE.Group): void {
  const geometry = new THREE.BoxGeometry(0.76, 0.075, 0.28);
  const red = new THREE.MeshStandardMaterial({ color: 0xe74343, roughness: 0.72 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf3f3ee, roughness: 0.72 });
  const pieces = 250;
  for (let i = 0; i < pieces; i++) {
    const progress = i / pieces;
    const profile = trackProfile(progress);
    if (profile.severity < 0.19) continue;
    for (const side of [-1, 1] as const) {
      const p = sampleTrack(progress, side * (ROAD_HALF_WIDTH - 1.8));
      const w = toWorld(p.x, p.y, 0.095);
      const kerb = new THREE.Mesh(geometry, i % 2 === 0 ? red : white);
      kerb.position.copy(w);
      kerb.rotation.y = headingToYaw(p.heading);
      kerb.receiveShadow = true;
      root.add(kerb);
    }
  }
}

function addStartFinish(root: THREE.Group): void {
  const start = sampleTrack(0);
  const world = toWorld(start.x, start.y, 0.097);
  const line = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.03, ROAD_HALF_WIDTH * WORLD_SCALE * 2.02),
    new THREE.MeshStandardMaterial({ color: 0xf8f8f3, roughness: 0.65 }),
  );
  line.position.copy(world);
  line.rotation.y = headingToYaw(start.heading);
  root.add(line);
}

function addGridBoxes(root: THREE.Group): void {
  const material = new THREE.MeshStandardMaterial({ color: 0xe9ebe7, roughness: 0.75 });
  const slots = [PLAYER_GRID, ...Array.from({ length: 7 }, (_, index) => aiGridSlot(index))];
  for (const slot of slots) {
    const p = sampleTrack(slot.progress, slot.laneOffset);
    const world = toWorld(p.x, p.y, 0.084);
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.022, 0.075), material);
    box.position.copy(world);
    box.rotation.y = headingToYaw(p.heading);
    root.add(box);
  }
}

function addSafetyBarriers(root: THREE.Group): void {
  const perSide = 190;
  const geometry = new THREE.BoxGeometry(0.95, 0.44, 0.13);
  const material = new THREE.MeshStandardMaterial({ color: 0xa9afb0, roughness: 0.78, metalness: 0.16 });
  const barriers = new THREE.InstancedMesh(geometry, material, perSide * 2);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);
  let index = 0;
  for (let i = 0; i < perSide; i++) {
    const progress = i / perSide;
    for (const side of [-1, 1] as const) {
      const p = sampleTrack(progress, side * (RUNOFF_HALF_WIDTH + 3));
      const world = toWorld(p.x, p.y, 0.22);
      quaternion.setFromAxisAngle(yAxis, headingToYaw(p.heading));
      matrix.compose(world, quaternion, new THREE.Vector3(1, 1, 1));
      barriers.setMatrixAt(index++, matrix);
    }
  }
  barriers.instanceMatrix.needsUpdate = true;
  barriers.castShadow = true;
  root.add(barriers);
}

function addPitBuildings(root: THREE.Group): void {
  const start = sampleTrack(0.035, 58);
  const world = toWorld(start.x, start.y, 0);
  const buildingMat = new THREE.MeshStandardMaterial({ color: 0x252c31, roughness: 0.7, metalness: 0.08 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x78a9b8, roughness: 0.28, metalness: 0.16 });
  const pit = new THREE.Mesh(new THREE.BoxGeometry(17, 3.4, 4.4), buildingMat);
  pit.position.set(world.x, 1.7, world.z);
  pit.rotation.y = headingToYaw(start.heading);
  pit.castShadow = true;
  root.add(pit);

  const glass = new THREE.Mesh(new THREE.BoxGeometry(15.5, 1.0, 0.08), glassMat);
  glass.position.copy(pit.position);
  glass.position.y = 2.25;
  glass.position.add(new THREE.Vector3(-Math.sin(start.heading), 0, Math.cos(start.heading)).multiplyScalar(2.22));
  glass.rotation.y = pit.rotation.y;
  root.add(glass);
}

function addGrandstands(root: THREE.Group): void {
  const material = new THREE.MeshStandardMaterial({ color: 0x6c7376, roughness: 0.9 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x1c2226, roughness: 0.72, metalness: 0.08 });
  for (const [progress, lane, length] of [[0.15, -60, 9], [0.47, 60, 11], [0.76, -60, 9]] as Array<[number, number, number]>) {
    const p = sampleTrack(progress, lane);
    const world = toWorld(p.x, p.y, 0);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(length, 2.2, 3.4), material);
    stand.position.set(world.x, 1.1, world.z);
    stand.rotation.y = headingToYaw(p.heading);
    stand.castShadow = true;
    root.add(stand);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(length + 0.8, 0.18, 4.1), roofMaterial);
    roof.position.set(world.x, 2.45, world.z);
    roof.rotation.y = stand.rotation.y;
    root.add(roof);
  }
}

function addBrakingBoards(root: THREE.Group): void {
  const postMat = new THREE.MeshStandardMaterial({ color: 0xe8e9e4, roughness: 0.82 });
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x171e22, roughness: 0.64 });
  for (const progress of [0.13, 0.31, 0.49, 0.67, 0.85]) {
    const p = sampleTrack(progress, 51);
    const world = toWorld(p.x, p.y, 0);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.3, 0.1), postMat);
    post.position.set(world.x, 1.15, world.z);
    root.add(post);
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.65, 0.1), boardMat);
    board.position.set(world.x, 2.15, world.z);
    board.rotation.y = headingToYaw(p.heading);
    root.add(board);
  }
}

function addSpeedReferencePosts(root: THREE.Group): void {
  const count = 320;
  const geometry = new THREE.BoxGeometry(0.13, 0.72, 0.13);
  const material = new THREE.MeshStandardMaterial({ color: 0xd7dcd7, roughness: 0.92 });
  const posts = new THREE.InstancedMesh(geometry, material, count);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const p = sampleTrack((i + 0.37) / count, side * 47);
    const world = toWorld(p.x, p.y, 0);
    matrix.compose(new THREE.Vector3(world.x, 0.36, world.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    posts.setMatrixAt(i, matrix);
  }
  posts.instanceMatrix.needsUpdate = true;
  posts.castShadow = true;
  root.add(posts);
}
