import { describe, expect, it } from 'vitest';
import { createTire } from './TireModel';
import { formatTyreRaceStatus, tyreRaceStatus } from './TyreRaceStatus';

describe('TyreRaceStatus', () => {
  it('turns rising wear into progressively stronger strategic warnings', () => {
    const fresh = tyreRaceStatus({ ...createTire('MEDIUM'), wear: 0.12 });
    const used = tyreRaceStatus({ ...createTire('MEDIUM'), wear: 0.45 });
    const cliff = tyreRaceStatus({ ...createTire('MEDIUM'), wear: 0.68 });

    expect(fresh.condition).toBe('OPTIMAL');
    expect(fresh.slideRisk).toBe('LOW');
    expect(used.condition).toBe('USED');
    expect(used.slideRisk).toBe('HIGH');
    expect(cliff.condition).toBe('CLIFF RISK');
    expect(cliff.estimatedPaceLoss).toBeGreaterThan(used.estimatedPaceLoss);
  });

  it('shows Hard as having more remaining laps to the cliff at equal wear', () => {
    const medium = tyreRaceStatus({ ...createTire('MEDIUM'), wear: 0.30 });
    const hard = tyreRaceStatus({ ...createTire('HARD'), wear: 0.30 });
    expect(hard.lapsToCliff).toBeGreaterThan(medium.lapsToCliff ?? 0);
  });

  it('shows one plain-language tyre message instead of pace, slide and cliff jargon', () => {
    const fresh = formatTyreRaceStatus(tyreRaceStatus({ ...createTire('MEDIUM'), wear: 0.12 }));
    const used = formatTyreRaceStatus(tyreRaceStatus({ ...createTire('MEDIUM'), wear: 0.45 }));
    const cliff = formatTyreRaceStatus(tyreRaceStatus({ ...createTire('MEDIUM'), wear: 0.68 }));

    expect(fresh).toMatch(/^TYRE OK · ~\d+ LAPS TO HEAVY WEAR$/);
    expect(used).toMatch(/^WORN · ~\d+ LAPS TO HEAVY WEAR$/);
    expect(cliff).toBe('PIT SOON · HEAVY WEAR');

    for (const message of [fresh, used, cliff]) {
      expect(message).not.toContain('PACE');
      expect(message).not.toContain('SLIDE');
      expect(message).not.toContain('CLIFF');
    }
  });
});
