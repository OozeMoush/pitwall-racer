import { describe, expect, it } from 'vitest';
import { createTire, stepTire } from './TireModel';

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

  it('creates a performance cliff late in tyre life', () => {
    let tire = { ...createTire('SOFT'), wear: 0.8 };
    tire = stepTire(tire, 'PUSH', 0.9, 1);
    expect(tire.grip).toBeLessThan(0.8);
  });
});
