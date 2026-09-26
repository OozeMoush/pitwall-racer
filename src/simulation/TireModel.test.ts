import { describe, expect, it } from 'vitest';
import { applyImpactTireDamage, createTire, stepTire } from './TireModel';

function run(mode: 'CONSERVE' | 'BALANCED' | 'PUSH', seconds = 120) {
  let tire = createTire('MEDIUM');
  for (let i = 0; i < seconds * 20; i++) tire = stepTire(tire, mode, 0.65, 1 / 20);
  return tire;
}

describe('TireModel', () => {
  it('makes push faster but materially more expensive in tyre life', () => {
    const push = run('PUSH');
    const conserve = run('CONSERVE');
    expect(push.wear).toBeGreaterThan(conserve.wear * 1.8);
  });

  it('still loses peak grip late in tyre life without making the car undriveable', () => {
    const fresh = createTire('SOFT');
    let tire = { ...fresh, wear: 0.8 };
    tire = stepTire(tire, 'PUSH', 0.9, 1);
    expect(tire.grip).toBeLessThan(fresh.grip * 0.91);
    expect(tire.grip).toBeGreaterThan(fresh.grip * 0.74);
  });

  it('turns a high-speed wall hit into meaningful persistent tyre wear', () => {
    const fresh = createTire('SOFT');
    const hit = applyImpactTireDamage(fresh, 'BARRIER', 82);
    expect(hit.wearAdded).toBeGreaterThan(0.10);
    expect(hit.tire.wear).toBeGreaterThan(0.10);
    expect(hit.tire.grip).toBeLessThan(fresh.grip);
  });

  it('makes car contact costly but less destructive than a wall hit', () => {
    const fresh = createTire('MEDIUM');
    const car = applyImpactTireDamage(fresh, 'CAR', 82);
    const wall = applyImpactTireDamage(fresh, 'BARRIER', 82);
    expect(car.wearAdded).toBeGreaterThan(0.02);
    expect(car.wearAdded).toBeLessThan(wall.wearAdded);
  });

});
