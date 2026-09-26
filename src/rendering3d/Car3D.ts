import * as THREE from 'three';
import { CAR_MODEL_SCALE, WHEEL_RADIUS, WHEEL_WIDTH, WHEEL_RING_RADIUS, WHEEL_RING_TUBE, WHEEL_RING_OFFSET, WHEEL_CENTRES } from '../simulation/CarGeometry';
import { WORLD_SCALE } from './WorldTransform';
import type { Compound } from '../simulation/TireModel';

const TYRE_COLORS: Record<Compound, number> = {
  SOFT: 0xff304d,
  MEDIUM: 0xffd326,
  HARD: 0xf4f5f2,
};

export interface FormulaCar3D {
  root: THREE.Group;
  setCompound(compound: Compound): void;
}

export function createFormulaCar(color: number, compound: Compound, player = false): FormulaCar3D {
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.24 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x101417, roughness: 0.55, metalness: 0.08 });
  const carbonMat = new THREE.MeshStandardMaterial({ color: 0x181b1d, roughness: 0.82, metalness: 0.12 });
  const highlightMat = new THREE.MeshStandardMaterial({ color: player ? 0xffffff : 0xd8dfe2, roughness: 0.35, metalness: 0.2 });

  const floor = mesh(new THREE.BoxGeometry(3.55, 0.16, 1.35), carbonMat, 0, 0.35, 0);
  const main = mesh(new THREE.BoxGeometry(2.45, 0.48, 0.86), bodyMat, -0.15, 0.63, 0);
  main.scale.z = 0.94;
  const sidepodL = mesh(new THREE.BoxGeometry(1.3, 0.42, 0.45), bodyMat, -0.15, 0.52, 0.62);
  const sidepodR = mesh(new THREE.BoxGeometry(1.3, 0.42, 0.45), bodyMat, -0.15, 0.52, -0.62);
  const nose = mesh(new THREE.BoxGeometry(1.65, 0.26, 0.34), bodyMat, 1.72, 0.58, 0);
  nose.rotation.z = -0.02;
  const noseTip = mesh(new THREE.BoxGeometry(0.72, 0.18, 0.28), highlightMat, 2.72, 0.51, 0);
  const engineCover = mesh(new THREE.BoxGeometry(1.15, 0.66, 0.48), bodyMat, -1.02, 0.9, 0);
  engineCover.rotation.z = 0.04;

  const cockpit = mesh(new THREE.SphereGeometry(0.42, 18, 10), darkMat, 0.05, 0.96, 0);
  cockpit.scale.set(1.3, 0.65, 0.86);
  const halo = new THREE.TorusGeometry(0.35, 0.045, 8, 24, Math.PI * 1.55);
  const haloMesh = mesh(halo, carbonMat, 0.12, 1.13, 0);
  haloMesh.rotation.x = Math.PI / 2;
  haloMesh.rotation.z = -Math.PI / 2;

  const frontWing = mesh(new THREE.BoxGeometry(0.48, 0.09, 2.28), carbonMat, 3.0, 0.34, 0);
  const frontFlap = mesh(new THREE.BoxGeometry(0.22, 0.08, 2.52), bodyMat, 3.2, 0.4, 0);
  const rearWing = mesh(new THREE.BoxGeometry(0.28, 0.16, 1.95), carbonMat, -2.15, 1.25, 0);
  const rearWingTop = mesh(new THREE.BoxGeometry(0.42, 0.12, 2.15), bodyMat, -2.22, 1.43, 0);
  const rearPillar = mesh(new THREE.BoxGeometry(0.18, 0.82, 0.14), carbonMat, -2.05, 0.96, 0);

  root.add(
    floor,
    main,
    sidepodL,
    sidepodR,
    nose,
    noseTip,
    engineCover,
    cockpit,
    haloMesh,
    frontWing,
    frontFlap,
    rearWing,
    rearWingTop,
    rearPillar,
  );

  const tyreMaterial = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.92, metalness: 0.02 });
  const ringMaterials: THREE.MeshStandardMaterial[] = [];
  const modelUnits = WORLD_SCALE / CAR_MODEL_SCALE;
  const wheelGeometry = new THREE.CylinderGeometry(WHEEL_RADIUS * modelUnits, WHEEL_RADIUS * modelUnits, WHEEL_WIDTH * modelUnits, 18);
  const ringGeometry = new THREE.TorusGeometry(WHEEL_RING_RADIUS * modelUnits, WHEEL_RING_TUBE * modelUnits, 8, 28);

  for (const wheel of WHEEL_CENTRES) {
    const x = wheel.x * modelUnits;
    const y = 0.53;
    const z = wheel.y * modelUnits;
    const tyre = mesh(wheelGeometry, tyreMaterial, x, y, z);
    tyre.rotation.x = Math.PI / 2;
    const ringMat = new THREE.MeshStandardMaterial({ color: TYRE_COLORS[compound], roughness: 0.65, metalness: 0.05 });
    ringMaterials.push(ringMat);
    const ring = mesh(ringGeometry, ringMat, x, y, z + Math.sign(z) * WHEEL_RING_OFFSET * modelUnits);
    // Torus already lies in the wheel face (XY), with its axle along Z.
    root.add(tyre, ring);
  }

  const marker = mesh(new THREE.BoxGeometry(0.24, 0.06, 0.52), highlightMat, -1.45, 1.23, 0);
  if (player) root.add(marker);

  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  // The original 3D car was visually larger than its new Rapier collider. A
  // smaller car both matches physical contact and gives the fixed top-down view
  // more speed in visible car-lengths per second.
  root.scale.setScalar(CAR_MODEL_SCALE);

  return {
    root,
    setCompound(next: Compound) {
      for (const material of ringMaterials) material.color.setHex(TYRE_COLORS[next]);
    },
  };
}

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material);
  result.position.set(x, y, z);
  return result;
}
