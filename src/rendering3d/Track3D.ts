import * as THREE from 'three';
import { aiGridSlot, PLAYER_GRID } from '../simulation/GridModel';
import { safetyBarrierSegments } from '../simulation/TrackBarrierModel';
import {
  TRACK_BARRIER_HALF_THICKNESS,
  TRACK_BARRIER_OFFSET,
  TRACK_BARRIER_SEGMENT_LENGTH,
  TRACK_KERB_INNER_OFFSET,
  TRACK_KERB_OUTER_OFFSET,
  TRACK_ROAD_HALF_WIDTH,
  TRACK_RUNOFF_HALF_WIDTH,
  trackBarrierOffset,
  trackKerbInnerOffset,
  trackKerbOuterOffset,
  trackRoadHalfWidth,
  trackRunoffHalfWidth,
} from '../simulation/TrackLimitsModel';
import { trackProfile } from '../simulation/TrackProfile';
import {
  RACING_LINE,
  sampleTrack,
  samplesForDistance,
  TRACK_LENGTH,
} from '../simulation/TrackModel';
import { headingToYaw, toWorld, WORLD_SCALE } from './WorldTransform';

export const ROAD_HALF_WIDTH = TRACK_ROAD_HALF_WIDTH;
export const EDGE_LINE_WIDTH_METRES = 0.75;
export const KERB_SEGMENT_METRES = 3;
export const BARRIER_SEGMENT_METRES = TRACK_BARRIER_SEGMENT_LENGTH;
export const SPEED_REFERENCE_SPACING_METRES = 12;

const RUBBERED_HALF_WIDTH = 10.5;
const MIN_TRACK_MESH_SAMPLES = 460;
const TRACK_MESH_SPACING_METRES = 5;

export function createTrack3D(): THREE.Group {
  const root = new THREE.Group();

  const ground = trackGroundBounds();
  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(ground.width, ground.depth, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x23472f, roughness: 1, metalness: 0 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.copy(ground.center);
  grass.receiveShadow = true;
  root.add(grass);

  addRibbon(root, trackRunoffHalfWidth, 0.004, 0x62686a, 0.98);
  addRibbon(root, trackRoadHalfWidth, 0.032, 0x2d3033, 0.9);
  addRibbon(root, RUBBERED_HALF_WIDTH, 0.043, 0x242729, 0.98);
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

export function trackMeshSampleCount(): number {
  return samplesForDistance(
    TRACK_LENGTH,
    TRACK_MESH_SPACING_METRES,
    MIN_TRACK_MESH_SAMPLES,
    2400,
  );
}

function trackGroundBounds(): {
  width: number;
  depth: number;
  center: THREE.Vector3;
} {
  const xs = RACING_LINE.map((point) => point.x);
  const ys = RACING_LINE.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const paddingMetres = 180;
  return {
    width: Math.max(820, (maxX - minX + paddingMetres * 2) * WORLD_SCALE),
    depth: Math.max(470, (maxY - minY + paddingMetres * 2) * WORLD_SCALE),
    center: toWorld((minX + maxX) / 2, (minY + maxY) / 2, -0.07),
  };
}

function addRibbon(
  root: THREE.Group,
  halfWidth: number | ((progress: number) => number),
  height: number,
  color: number,
  roughness: number,
): void {
  const mesh = new THREE.Mesh(
    ribbonGeometry(halfWidth, height),
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 }),
  );
  mesh.receiveShadow = true;
  root.add(mesh);
}

function ribbonGeometry(
  halfWidth: number | ((progress: number) => number),
  height: number,
): THREE.BufferGeometry {
  const vertices: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const sampleCount = trackMeshSampleCount();
  for (let i = 0; i <= sampleCount; i++) {
    const p = i / sampleCount;
    const localHalfWidth = typeof halfWidth === 'function'
      ? halfWidth(p)
      : halfWidth;
    const left = sampleTrack(p, localHalfWidth);
    const right = sampleTrack(p, -localHalfWidth);
    const lw = toWorld(left.x, left.y, height);
    const rw = toWorld(right.x, right.y, height);
    vertices.push(lw.x, lw.y, lw.z, rw.x, rw.y, rw.z);
    uvs.push(0, p * 36, 1, p * 36);
    if (i < sampleCount) {
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

function offsetRibbonGeometry(
  offsetA: number,
  offsetB: number,
  height: number,
): THREE.BufferGeometry {
  return variableOffsetRibbonGeometry(
    () => offsetA,
    () => offsetB,
    height,
  );
}

function variableOffsetRibbonGeometry(
  offsetA: (progress: number) => number,
  offsetB: (progress: number) => number,
  height: number,
): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  const sampleCount = trackMeshSampleCount();
  for (let i = 0; i <= sampleCount; i++) {
    const progress = i / sampleCount;
    const a = sampleTrack(progress, offsetA(progress));
    const b = sampleTrack(progress, offsetB(progress));
    const aw = toWorld(a.x, a.y, height);
    const bw = toWorld(b.x, b.y, height);
    vertices.push(aw.x, aw.y, aw.z, bw.x, bw.y, bw.z);
    if (i < sampleCount) {
      const i0 = i * 2;
      const i1 = i0 + 1;
      const i2 = i0 + 2;
      const i3 = i0 + 3;
      indices.push(i0, i2, i1, i1, i2, i3);
    }
  }
  return finishGeometry(vertices, indices);
}

function appendOffsetStrip(
  vertices: number[],
  indices: number[],
  startProgress: number,
  endProgress: number,
  offsetA: number,
  offsetB: number,
  height: number,
  subdivisions: number,
): void {
  const baseVertex = vertices.length / 3;
  const steps = Math.max(1, Math.round(subdivisions));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const progress = startProgress + (endProgress - startProgress) * t;
    const a = sampleTrack(progress, offsetA);
    const b = sampleTrack(progress, offsetB);
    const aw = toWorld(a.x, a.y, height);
    const bw = toWorld(b.x, b.y, height);
    vertices.push(aw.x, aw.y, aw.z, bw.x, bw.y, bw.z);
    if (i < steps) {
      const i0 = baseVertex + i * 2;
      const i1 = i0 + 1;
      const i2 = i0 + 2;
      const i3 = i0 + 3;
      indices.push(i0, i2, i1, i1, i2, i3);
    }
  }
}

function finishGeometry(vertices: number[], indices: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addEdgeLines(root: THREE.Group): void {
  const material = new THREE.MeshStandardMaterial({ color: 0xf2f3ef, roughness: 0.76 });
  for (const side of [-1, 1] as const) {
    const half = EDGE_LINE_WIDTH_METRES / 2;
    const line = new THREE.Mesh(
      variableOffsetRibbonGeometry(
        (progress) => side * (trackRoadHalfWidth(progress) - 0.45) - half,
        (progress) => side * (trackRoadHalfWidth(progress) - 0.45) + half,
        0.073,
      ),
      material,
    );
    line.receiveShadow = true;
    root.add(line);
  }
}

function kerbChunkIsSafe(start: number, end: number, innerOffset: number, outerOffset: number): boolean {
  const centreStart = sampleTrack(start);
  const centreEnd = sampleTrack(end);
  const innerStart = sampleTrack(start, innerOffset);
  const innerEnd = sampleTrack(end, innerOffset);
  const outerStart = sampleTrack(start, outerOffset);
  const outerEnd = sampleTrack(end, outerOffset);

  const centreDx = centreEnd.x - centreStart.x;
  const centreDy = centreEnd.y - centreStart.y;
  const centreLength = Math.hypot(centreDx, centreDy);
  if (centreLength < 0.05) return false;

  const aligned = (ax: number, ay: number, bx: number, by: number) => {
    const length = Math.hypot(ax, ay);
    if (length < centreLength * 0.20 || length > centreLength * 2.8) return false;
    return (ax * bx + ay * by) / Math.max(0.0001, length * centreLength) > 0.15;
  };

  return aligned(innerEnd.x - innerStart.x, innerEnd.y - innerStart.y, centreDx, centreDy)
    && aligned(outerEnd.x - outerStart.x, outerEnd.y - outerStart.y, centreDx, centreDy);
}

function addCornerKerbs(root: THREE.Group): void {
  const chunkCount = Math.max(1, Math.ceil(TRACK_LENGTH / KERB_SEGMENT_METRES));
  const redVertices: number[] = [];
  const redIndices: number[] = [];
  const whiteVertices: number[] = [];
  const whiteIndices: number[] = [];

  for (let chunk = 0; chunk < chunkCount; chunk++) {
    const start = chunk / chunkCount;
    const end = (chunk + 1) / chunkCount;
    const mid = (start + end) / 2;
    const profile = trackProfile(mid);
    if (profile.severity < 0.20 || Math.abs(profile.signedTurn) < 0.028) continue;

    const side = Math.sign(profile.signedTurn);
    const inner = side * trackKerbInnerOffset(mid);
    const outer = side * trackKerbOuterOffset(mid);
    // At the very tight miniature apexes, offset curves can locally fold over
    // themselves. Drawing that quad produces the red/white star-shaped spikes
    // seen in play. Omit only the degenerate pieces; the wall still enforces the
    // corner and neighbouring kerb chunks remain visible.
    if (!kerbChunkIsSafe(start, end, inner, outer)) continue;

    const vertices = chunk % 2 === 0 ? redVertices : whiteVertices;
    const indices = chunk % 2 === 0 ? redIndices : whiteIndices;
    appendOffsetStrip(vertices, indices, start, end, inner, outer, 0.112, 2);
  }

  const materialOptions = {
    roughness: 0.74,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  } as const;
  if (redVertices.length > 0) {
    const red = new THREE.Mesh(
      finishGeometry(redVertices, redIndices),
      new THREE.MeshStandardMaterial({ color: 0xe74343, ...materialOptions }),
    );
    red.receiveShadow = true;
    root.add(red);
  }
  if (whiteVertices.length > 0) {
    const white = new THREE.Mesh(
      finishGeometry(whiteVertices, whiteIndices),
      new THREE.MeshStandardMaterial({ color: 0xf3f3ee, ...materialOptions }),
    );
    white.receiveShadow = true;
    root.add(white);
  }
}

function addStartFinish(root: THREE.Group): void {
  const start = sampleTrack(0);
  const world = toWorld(start.x, start.y, 0.097);
  const line = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.03, trackRoadHalfWidth(0) * WORLD_SCALE * 2.02),
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
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.025, 0.13), material);
    box.position.copy(world);
    box.rotation.y = headingToYaw(p.heading);
    root.add(box);
  }
}

function addSafetyBarriers(root: THREE.Group): void {
  const segments = safetyBarrierSegments();
  const worldThickness = TRACK_BARRIER_HALF_THICKNESS * 2 * WORLD_SCALE;
  const geometry = new THREE.BoxGeometry(1, 0.54, worldThickness);
  const material = new THREE.MeshStandardMaterial({ color: 0xa9afb0, roughness: 0.78, metalness: 0.16 });
  const barriers = new THREE.InstancedMesh(geometry, material, segments.length);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);

  segments.forEach((segment, index) => {
    const world = toWorld(segment.x, segment.y, 0.27);
    quaternion.setFromAxisAngle(yAxis, headingToYaw(segment.heading));
    matrix.compose(
      world,
      quaternion,
      new THREE.Vector3(segment.length * WORLD_SCALE * 0.985, 1, 1),
    );
    barriers.setMatrixAt(index, matrix);
  });

  barriers.instanceMatrix.needsUpdate = true;
  barriers.castShadow = true;
  barriers.receiveShadow = true;
  root.add(barriers);
}

function addPitBuildings(root: THREE.Group): void {
  const start = sampleTrack(0.035, RUNOFF_HALF_WIDTH + 16);
  const world = toWorld(start.x, start.y, 0);
  const buildingMat = new THREE.MeshStandardMaterial({ color: 0x252c31, roughness: 0.7, metalness: 0.08 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x78a9b8, roughness: 0.28, metalness: 0.16 });
  const pit = new THREE.Mesh(new THREE.BoxGeometry(13.5, 3.0, 3.7), buildingMat);
  pit.position.set(world.x, 1.5, world.z);
  pit.rotation.y = headingToYaw(start.heading);
  pit.castShadow = true;
  root.add(pit);

  const glass = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.9, 0.08), glassMat);
  glass.position.copy(pit.position);
  glass.position.y = 2.0;
  glass.position.add(new THREE.Vector3(-Math.sin(start.heading), 0, Math.cos(start.heading)).multiplyScalar(1.87));
  glass.rotation.y = pit.rotation.y;
  root.add(glass);
}

function addGrandstands(root: THREE.Group): void {
  const material = new THREE.MeshStandardMaterial({ color: 0x6c7376, roughness: 0.9 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x1c2226, roughness: 0.72, metalness: 0.08 });
  for (const [progress, side, length] of [[0.15, -1, 7.2], [0.47, 1, 8.8], [0.76, -1, 7.2]] as Array<[number, number, number]>) {
    const p = sampleTrack(progress, side * (trackRunoffHalfWidth(progress) + 16));
    const world = toWorld(p.x, p.y, 0);
    const stand = new THREE.Mesh(new THREE.BoxGeometry(length, 1.9, 2.9), material);
    stand.position.set(world.x, 0.95, world.z);
    stand.rotation.y = headingToYaw(p.heading);
    stand.castShadow = true;
    root.add(stand);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(length + 0.6, 0.16, 3.45), roofMaterial);
    roof.position.set(world.x, 2.1, world.z);
    roof.rotation.y = stand.rotation.y;
    root.add(roof);
  }
}

function addBrakingBoards(root: THREE.Group): void {
  const postMat = new THREE.MeshStandardMaterial({ color: 0xe8e9e4, roughness: 0.82 });
  const boardMat = new THREE.MeshStandardMaterial({ color: 0x171e22, roughness: 0.64 });
  for (const progress of [0.13, 0.31, 0.49, 0.67, 0.85]) {
    const p = sampleTrack(progress, trackRunoffHalfWidth(progress) + 6);
    const world = toWorld(p.x, p.y, 0);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.0, 0.12), postMat);
    post.position.set(world.x, 1.0, world.z);
    root.add(post);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.62, 0.10), boardMat);
    board.position.set(world.x, 1.9, world.z);
    board.rotation.y = headingToYaw(p.heading);
    root.add(board);
  }
}

function addSpeedReferencePosts(root: THREE.Group): void {
  const count = Math.max(100, Math.ceil(TRACK_LENGTH / SPEED_REFERENCE_SPACING_METRES));
  const geometry = new THREE.BoxGeometry(0.15, 0.78, 0.15);
  const material = new THREE.MeshStandardMaterial({ color: 0xd7dcd7, roughness: 0.92 });
  const posts = new THREE.InstancedMesh(geometry, material, count);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const progress = (i + 0.5) / count;
    const p = sampleTrack(progress, side * (trackBarrierOffset(progress) + 2.4));
    const world = toWorld(p.x, p.y, 0);
    matrix.compose(new THREE.Vector3(world.x, 0.39, world.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    posts.setMatrixAt(i, matrix);
  }
  posts.instanceMatrix.needsUpdate = true;
  posts.castShadow = true;
  root.add(posts);
}
