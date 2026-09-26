import * as THREE from 'three';
import { expect, it } from 'vitest';
import { createFormulaCar } from '../rendering3d/Car3D';
import { WORLD_SCALE } from '../rendering3d/WorldTransform';
import { isEntireCarBeyondTrack, isEntireCarBeyondTrackAt, TRACK_LIMIT_HALF_WIDTH } from './LapValidityModel';
import { WHEEL_CENTRES } from './CarGeometry';
import { sampleTrack, projectTrack } from './TrackModel';
import { TRACK_ROAD_HALF_WIDTH } from './TrackLimitsModel';

it('keeps any visible tyre touching the white line legal at every heading', () => {
  const car = createFormulaCar(0xffffff, 'SOFT');
  const wheels = car.root.children.filter(child => child instanceof THREE.Mesh && Math.abs(child.position.z) > 0.9
    && (child.geometry instanceof THREE.CylinderGeometry || child.geometry instanceof THREE.TorusGeometry)) as THREE.Mesh[];
  expect(wheels).toHaveLength(8);
  for (let degree = 0; degree < 360; degree += 5) {
    const heading = degree * Math.PI / 180;
    car.root.rotation.y = -heading;
    car.root.updateMatrixWorld(true);
    const lateral: number[] = [];
    for (const wheel of wheels) {
      const vertices = wheel.geometry.getAttribute('position');
      for (let i = 0; i < vertices.count; i++) {
        lateral.push(new THREE.Vector3().fromBufferAttribute(vertices, i).applyMatrix4(wheel.matrixWorld).z / WORLD_SCALE);
      }
    }
    if (degree === 0) expect(Math.max(...lateral)).toBeCloseTo(TRACK_LIMIT_HALF_WIDTH, 5);
    const rightTouch = TRACK_ROAD_HALF_WIDTH - Math.min(...lateral);
    const leftTouch = -TRACK_ROAD_HALF_WIDTH - Math.max(...lateral);
    expect(isEntireCarBeyondTrack(rightTouch - 0.01, 0, heading)).toBe(false);
    expect(isEntireCarBeyondTrack(leftTouch + 0.01, 0, heading)).toBe(false);
    expect(isEntireCarBeyondTrack(rightTouch + 1, 0, heading)).toBe(true);
    expect(isEntireCarBeyondTrack(leftTouch - 1, 0, heading)).toBe(true);
  }
});

it('does not warn on curved road when a visible wheel centre is still on asphalt', () => {
  for (let i = 0; i < 160; i++) {
    for (const lane of [-20, -19.2, 19.2, 20]) {
      const pose = sampleTrack(i / 160, lane);
      for (const angle of [-0.3, 0, 0.3]) {
        const heading = pose.heading + angle;
        const hasWheelOnRoad = WHEEL_CENTRES.some(wheel => projectTrack(
          pose.x + wheel.x * Math.cos(heading) - wheel.y * Math.sin(heading),
          pose.y + wheel.x * Math.sin(heading) + wheel.y * Math.cos(heading),
        ).distance <= TRACK_ROAD_HALF_WIDTH);
        if (hasWheelOnRoad) expect(
          isEntireCarBeyondTrackAt(pose.x, pose.y, heading),
          `progress=${i / 160} lane=${lane}`,
        ).toBe(false);
      }
    }
  }
});
