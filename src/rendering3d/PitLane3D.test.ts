import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { TRACKS, setActiveTrack } from '../simulation/TrackModel';
import { pitLanePose } from '../simulation/PitLaneModel';
import { PIT_LANE_HALF_WIDTH, pitRibbonGeometry } from './PitLane3D';

afterEach(() => setActiveTrack('pitwall-gp'));

describe('PitLane3D', () => {
  it('winds the pit-lane road upward so the overhead camera can see it', () => {
    const geometry = pitRibbonGeometry(-20, 20, 0.04);
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    expect(index).not.toBeNull();

    const a = new THREE.Vector3().fromBufferAttribute(position, index!.getX(0));
    const b = new THREE.Vector3().fromBufferAttribute(position, index!.getX(1));
    const c = new THREE.Vector3().fromBufferAttribute(position, index!.getX(2));
    const normal = b.clone().sub(a).cross(c.clone().sub(a));

    expect(normal.y).toBeGreaterThan(0);
    it('keeps the visible pit ribbon continuous and upward-facing on every circuit', () => {
    for (const track of TRACKS) {
      setActiveTrack(track.id);
      const geometry = pitRibbonGeometry(
        -PIT_LANE_HALF_WIDTH,
        PIT_LANE_HALF_WIDTH,
        0.04,
      );
      const position = geometry.getAttribute('position');
      const index = geometry.getIndex();
      expect(index).not.toBeNull();

      let minimumNormalY = Number.POSITIVE_INFINITY;
      for (let triangle = 0; triangle < index!.count; triangle += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(position, index!.getX(triangle));
        const b = new THREE.Vector3().fromBufferAttribute(position, index!.getX(triangle + 1));
        const d = new THREE.Vector3().fromBufferAttribute(position, index!.getX(triangle + 2));
        const normalY = b.clone().sub(a).cross(d.clone().sub(a)).y;
        minimumNormalY = Math.min(minimumNormalY, normalY);
      }
      expect(minimumNormalY).toBeGreaterThan(0);
    }
  });

  it('does not jump between neighbouring track segments while drawing the pit centre', () => {
    for (const track of TRACKS) {
      setActiveTrack(track.id);
      let previous = pitLanePose(0);
      for (let index = 1; index <= 256; index++) {
        const current = pitLanePose(index / 256);
        expect(Math.hypot(current.x - previous.x, current.y - previous.y)).toBeLessThan(6);
        previous = current;
      }
    }
  });
});
});
