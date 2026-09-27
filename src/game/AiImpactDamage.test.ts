import { describe, expect, it } from 'vitest';
import { CoreRaceGame } from './CoreRaceGame';
import { ImpactDamageTracker } from '../simulation/ImpactDamageTracker';
import { createAiField } from '../simulation/RaceModel';

describe('CoreRaceGame CPU impact tyre damage', () => {
  it('adds persistent damage once per physical impact and rearms after separation', () => {
    const driver = createAiField()[0];
    let contact: 'NONE' | 'CAR' | 'BARRIER' = 'BARRIER';

    const game = Object.assign(Object.create(CoreRaceGame.prototype), {
      ai: [driver],
      aiImpactDamage: [new ImpactDamageTracker()],
      physics: {
        aiContactKind: () => contact,
        aiImpactSpeed: () => 82,
      },
    }) as any;

    const freshWear = driver.tire.wear;
    game.applyAiImpactDamage(1 / 120);
    const firstImpactWear = driver.tire.wear;
    expect(firstImpactWear).toBeGreaterThan(freshWear);

    // Sustained contact is one crash, not damage every physics frame.
    game.applyAiImpactDamage(1 / 120);
    expect(driver.tire.wear).toBeCloseTo(firstImpactWear);

    // After a real separation, a new impact may damage the tyre again.
    contact = 'NONE';
    game.applyAiImpactDamage(0.16);
    contact = 'BARRIER';
    game.applyAiImpactDamage(1 / 120);
    expect(driver.tire.wear).toBeGreaterThan(firstImpactWear);
  });
});
