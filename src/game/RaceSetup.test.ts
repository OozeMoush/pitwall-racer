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
    expect(pitwall).toBeGreaterThanOrEqual(15);
    expect(pitwall).toBeLessThanOrEqual(24);
    expect(baku).toBeGreaterThanOrEqual(15);
    expect(baku).toBeLessThanOrEqual(24);
    expect(Math.abs(pitwall - baku)).toBeLessThanOrEqual(3);
  });

  it('keeps compact and standard circuits on the same race-duration axis', () => {
    const compactLaps = raceLapsForPreset('serra-circuit', 'STANDARD');
    const standardLaps = raceLapsForPreset('pitwall-gp', 'STANDARD');
    const compactMinutes = compactLaps * 23.119 / 60;
    const standardMinutes = standardLaps * 90 / 60;

    expect(compactLaps).toBeGreaterThan(standardLaps * 3);
    expect(compactMinutes).toBeGreaterThan(26);
    expect(compactMinutes).toBeLessThan(28);
    expect(standardMinutes).toBeCloseTo(27, 6);
  });

  it('uses the standard duration for the default race', () => {
    expect(DEFAULT_RACE_SETUP.raceLength).toBe('STANDARD');
    expect(DEFAULT_RACE_SETUP.totalLaps).toBe(
      raceLapsForPreset('pitwall-gp', 'STANDARD'),
    );
  });
});
