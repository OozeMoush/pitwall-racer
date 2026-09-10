import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { pitRibbonGeometry } from './PitLane3D';

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
  });
});
