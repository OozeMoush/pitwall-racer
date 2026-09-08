import * as THREE from 'three';
import { sampleTrack } from '../simulation/TrackModel';
import { headingToYaw, toWorld, WORLD_SCALE } from './WorldTransform';

// Deliberately narrow: the dark groove should read as a racing line inside a
// road that is only a little wider than two formula cars side-by-side.
const ROAD_HALF_WIDTH = 28;
const RUNOFF_HALF_WIDTH = 42;
const SAMPLE_COUNT = 420;

export function createTrack3D(): THREE.Group {
  const root = new THREE.Group();

  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(390, 220, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x244b32, roughness: 1, metalness: 0 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.055;
  grass.receiveShadow = true;
  root.add(grass);

  const runoff = new THREE.Mesh(
    ribbonGeometry(RUNOFF_HALF_WIDTH, 0.005),
    new THREE.MeshStandardMaterial({ color: 0x767b7d, roughness: 0.95, metalness: 0.02 }),
  );
  runoff.receiveShadow = true;
  root.add(runoff);

  const road = new THREE.Mesh(
    ribbonGeometry(ROAD_HALF_WIDTH, 0.035),
    new THREE.MeshStandardMaterial({ color: 0x2d3034, roughness: 0.88, metalness: 0.03 }),
  );
  road.receiveShadow = true;
  root.add(road);

  const groove = new THREE.Mesh(
    ribbonGeometry(17.5, 0.046),
    new THREE.MeshStandardMaterial({ color: 0x202326, roughness: 0.98, metalness: 0 }),
  );
  groove.receiveShadow = true;
  root.add(groove);

  addKerbs(root);
  addStartFinish(root);
  addGridBoxes(root);
  addPitBuildings(root);
  addGrandstands(root);
  addTracksideMarkers(root);
  addSpeedReferencePosts(root);
  addRoadEdgeSpeedTicks(root);

  return root;
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
    uvs.push(0, p * 30, 1, p * 30);

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

function addKerbs(root: THREE.Group): void {
  const geometry = new THREE.BoxGeometry(0.72, 0.08, 0.22);
  const red = new THREE.MeshStandardMaterial({ color: 0xe94747, roughness: 0.72 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf0f1ec, roughness: 0.72 });
  const pieces = 260;

  for (let i = 0; i < pieces; i++) {
    const progress = i / pieces;
    const paint = i % 2 === 0 ? red : white;
    for (const side of [-1, 1] as const) {
      const p = sampleTrack(progress, side * (ROAD_HALF_WIDTH - 1.6));
      const w = toWorld(p.x, p.y, 0.09);
      const kerb = new THREE.Mesh(geometry, paint);
      kerb.position.copy(w);
      kerb.rotation.y = headingToYaw(p.heading);
      kerb.castShadow = true;
      kerb.receiveShadow = true;
      root.add(kerb);
    }
  }
}

function addStartFinish(root: THREE.Group): void {
  const start = sampleTrack(0);
  const world = toWorld(start.x, start.y, 0.095);
  const line = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.03, ROAD_HALF_WIDTH * WORLD_SCALE * 2.02),
    new THREE.MeshStandardMaterial({ color: 0xf7f7f3, roughness: 0.65 }),
  );
  line.position.copy(world);
  line.rotation.y = headingToYaw(start.heading);
  line.receiveShadow = true;
  root.add(line);
}

function addGridBoxes(root: THREE.Group): void {
  const mat = new THREE.MeshStandardMaterial({ color: 0xf0f0ec, roughness: 0.72 });
  for (let slot = 0; slot < 8; slot++) {
    const row = Math.floor(slot / 2);
    const progress = 0.052 - row * 0.0135;
    const side = slot % 2 === 0 ? -1 : 1;
    const p = sampleTrack(progress, side * 10);
    const world = toWorld(p.x, p.y, 0.085);
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.025, 0.07), mat);
    box.position.copy(world);
    box.rotation.y = headingToYaw(p.heading);
    root.add(box);
  }
}

function addPitBuildings(root: THREE.Group): void {
  const start = sampleTrack(0.035, 60);
  const world = toWorld(start.x, start.y, 0);
  const buildingMat = new THREE.MeshStandardMaterial({ color: 0x252c31, roughness: 0.7, metalness: 0.08 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x7eb3c2, roughness: 0.26, metalness: 0.18 });
  const pit = new THREE.Mesh(new THREE.BoxGeometry(17, 3.4, 4.4), buildingMat);
  pit.position.set(world.x, 1.7, world.z);
  pit.rotation.y = headingToYaw(start.heading);
  pit.castShadow = true;
  pit.receiveShadow = true;
  root.add(pit);

  const glass = new THREE.Mesh(new THREE.BoxGeometry(15.5, 1.0, 0.08), glassMat);
  glass.position.copy(pit.position);
  glass.position.y = 2.25;
  const outward = new THREE.Vector3(-Math.sin(start.heading), 0, Math.cos(start.heading)).multiplyScalar(2.22);
  glass.position.add(outward);
  glass.rotation.y = pit.rotation.y;
  root.add(glass);
}

function addGrandstands(root: THREE.Group): void {
  const material = new THREE.MeshStandardMaterial({ color: 0x6e7478, roughness: 0.9 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x1c2226, roughness: 0.72, metalness: 0.08 });
  const locations: Array<[number, number, number]> = [
    [0.15, -62, 9],
    [0.47, 62, 11],
    [0.76, -62, 9],
  ];

  for (const [progress, lane, length] of locations) {
    const p = sampleTrack(progress, lane);
    const world = toWorld(p.x, p.y, 0);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(length, 2.2, 3.4), material);
    stand.position.set(world.x, 1.1, world.z);
    stand.rotation.y = headingToYaw(p.heading);
    stand.castShadow = true;
    stand.receiveShadow = true;
    root.add(stand);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(length + 0.8, 0.18, 4.1), roofMaterial);
    roof.position.set(world.x, 2.45, world.z);
    roof.rotation.y = stand.rotation.y;
    roof.castShadow = true;
    root.add(roof);
  }
}

function addTracksideMarkers(root: THREE.Group): void {
  const postMat = new THREE.MeshStandardMaterial({ color: 0xe6e8e4, roughness: 0.8 });
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x192126, roughness: 0.6 });
  for (const progress of [0.15, 0.33, 0.51, 0.69, 0.86]) {
    const p = sampleTrack(progress, 54);
    const world = toWorld(p.x, p.y, 0);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.5, 0.12), postMat);
    post.position.set(world.x, 1.25, world.z);
    root.add(post);
    const board = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.72, 0.12), boardMat);
    board.position.set(world.x, 2.35, world.z);
    board.rotation.y = headingToYaw(p.heading);
    board.castShadow = true;
    root.add(board);
  }
}

function addSpeedReferencePosts(root: THREE.Group): void {
  const count = 400;
  const material = new THREE.MeshStandardMaterial({ color: 0xd8dcd7, roughness: 0.92 });
  const geometry = new THREE.BoxGeometry(0.09, 0.55, 0.09);
  const posts = new THREE.InstancedMesh(geometry, material, count);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);

  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const p = sampleTrack((i + 0.35) / count, side * 49);
    const world = toWorld(p.x, p.y, 0);
    matrix.compose(new THREE.Vector3(world.x, 0.275, world.z), quaternion, scale);
    posts.setMatrixAt(i, matrix);
  }
  posts.instanceMatrix.needsUpdate = true;
  posts.castShadow = true;
  root.add(posts);
}

function addRoadEdgeSpeedTicks(root: THREE.Group): void {
  const perSide = 360;
  const material = new THREE.MeshStandardMaterial({ color: 0xf2f2ed, roughness: 0.78 });
  const geometry = new THREE.BoxGeometry(0.52, 0.018, 0.075);
  const ticks = new THREE.InstancedMesh(geometry, material, perSide * 2);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const yAxis = new THREE.Vector3(0, 1, 0);
  let index = 0;

  for (let i = 0; i < perSide; i++) {
    const progress = (i + 0.2) / perSide;
    for (const side of [-1, 1] as const) {
      const p = sampleTrack(progress, side * (ROAD_HALF_WIDTH - 2.4));
      const world = toWorld(p.x, p.y, 0.073);
      position.set(world.x, world.y, world.z);
      quaternion.setFromAxisAngle(yAxis, headingToYaw(p.heading));
      matrix.compose(position, quaternion, scale);
      ticks.setMatrixAt(index++, matrix);
    }
  }
  ticks.instanceMatrix.needsUpdate = true;
  root.add(ticks);
}
