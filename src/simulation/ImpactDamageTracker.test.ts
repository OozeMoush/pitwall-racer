import { expect, it } from 'vitest';
import { ImpactDamageTracker } from './ImpactDamageTracker';
import { applyImpactTireDamage, createTire } from './TireModel';

it('applies persistent wear once for a sustained impact, including one-frame contact chatter', () => {
  const tracker = new ImpactDamageTracker();
  let tire = createTire('SOFT');
  let impacts = 0;
  for (let tick = 0; tick < 1200; tick++) {
    const contact = tick > 0 && tick % 30 === 0 ? 'NONE' : 'BARRIER';
    if (tracker.sample(contact, 1 / 120)) {
      tire = applyImpactTireDamage(tire, 'BARRIER', 70).tire;
      impacts++;
    }
  }
  expect(impacts).toBe(1);
  expect(tire.wear).toBeCloseTo(applyImpactTireDamage(createTire('SOFT'), 'BARRIER', 70).tire.wear);
  for (let i = 0; i < 30; i++) tracker.sample('NONE', 1 / 120);
  expect(tracker.sample('CAR', 1 / 120)).toBe(true);
  expect(tracker.sample('CAR', 1 / 120)).toBe(false);
  tracker.reset();
  expect(tracker.sample('BARRIER', 1 / 120)).toBe(true);
});
