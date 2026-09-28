import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RACE_SETUP,
  RACE_LENGTH_OPTIONS,
  raceLapsForPreset,
} from './RaceSetup';

describe('RaceSetup duration presets', () => {
  it('keeps race duration ordered from short to long', () => {
    expect(RACE_LENGTH_OPTIONS.map((option) => option.targetMinutes)).toEqual([18, 27, 36]);
    expect(raceLapsForPreset('pitwall-gp', 'SHORT')).toBeLessThan(
      raceLapsForPreset('pitwall-gp', 'STANDARD'),
    );
    expect(raceLapsForPreset('pitwall-gp', 'STANDARD')).toBeLessThan(
      raceLapsForPreset('pitwall-gp', 'LONG'),
    );
  });

  it('derives different lap counts from circuit pace', () => {
    const pitwall = raceLapsForPreset('pitwall-gp', 'STANDARD');
    const baku = raceLapsForPreset('baku-street', 'STANDARD');
    expect(pitwall).toBeLessThan(baku);
    expect(pitwall).toBeGreaterThanOrEqual(15);
    expect(pitwall).toBeLessThanOrEqual(24);
    expect(baku).toBeGreaterThan(35);
  });

  it('uses the standard duration for the default race', () => {
    expect(DEFAULT_RACE_SETUP.raceLength).toBe('STANDARD');
    expect(DEFAULT_RACE_SETUP.totalLaps).toBe(
      raceLapsForPreset('pitwall-gp', 'STANDARD'),
    );
  });
});
