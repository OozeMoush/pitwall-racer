import * as THREE from 'three';
import { sampleTrack } from '../simulation/TrackModel';
import { headingToYaw, toWorld, WORLD_SCALE } from './WorldTransform';

const ROAD_HALF_WIDTH = 55;
const RUNOFF_HALF_WIDTH = 76;
const SAMPLE_COUNT = 320;

export function createTrack3D(): THREE.Group {
  const root = new THREE.Group();

  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(132, 94, 1, 1),
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
    ribbonGeometry(24, 0.046),
    new THREE.MeshStandardMaterial({ color: 0x24272a, roughness: 0.96, metalness: 0 }),
  );
  groove.receiveShadow = true;
  root.add(groove);

  addKerbs(root);
  addStartFinish(root);
  addGridBoxes(root);
  addPitBuildings(root);
  addGrandstands(root);
  addTracksideMarkers(root);

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
    uvs.push(0, p * 18, 1, p * 18);

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
  const geometry = new THREE.BoxGeometry(0.78, 0.08, 0.24);
  const red = new THREE.MeshStandardMaterial({ color: 0xe94747, roughness: 0.72 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf0f1ec, roughness: 0.72 });
  const pieces = 118;

  for (let i = 0; i < pieces; i++) {
    const progress = i / pieces;
    const paint = i % 2 === 0 ? red : white;
    for (const side of [-1, 1] as const) {
      const p = sampleTrack(progress, side * (ROAD_HALF_WIDTH - 2));
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
  for (let row = 0; row < 8; row++) {
    const progress = 0.986 - row * 0.0085;
    const side = row % 2 === 0 ? 1 : -1;
    const p = sampleTrack(progress, side * 17);
    const world = toWorld(p.x, p.y, 0.085);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.025, 0.06), mat);
    box.position.copy(world);
    box.rotation.y = headingToYaw(p.heading);
    root.add(box);
  }
}

function addPitBuildings(root: THREE.Group): void {
  const start = sampleTrack(0.035, 105);
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
    [0.16, -108, 8],
    [0.49, 102, 10],
    [0.73, -104, 8],
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
  for (const progress of [0.18, 0.41, 0.64, 0.87]) {
    const p = sampleTrack(progress, 92);
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
