import { TRACKS, getTrackDefinition } from '../simulation/TrackModel';
import { createAiField } from '../simulation/RaceModel';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RACE_SETUP,
  RACE_LENGTH_OPTIONS,
  raceLapsForPreset,
} from './RaceSetup';

describe('RaceSetup duration presets', () => {
  it('keeps race duration ordered from short to long', () => {
    expect(RACE_LENGTH_OPTIONS.map((option) => option.targetMinutes)).toEqual([8, 18, 27, 36]);
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
    expect(pitwall).toBeGreaterThan(45);
    expect(pitwall).toBeLessThan(60);
    expect(baku).toBeGreaterThanOrEqual(15);
    expect(baku).toBeLessThanOrEqual(24);
    expect(pitwall).toBeGreaterThan(baku * 2);
  });

  it('keeps compact and standard circuits on the same race-duration axis', () => {
    const compactLaps = raceLapsForPreset('serra-circuit', 'STANDARD');
    const standardLaps = raceLapsForPreset('baku-street', 'STANDARD');
    const compactMinutes = compactLaps * 23.119 / 60;
    const standardMinutes = standardLaps * 90 / 60;

    expect(compactLaps).toBeGreaterThan(standardLaps * 3);
    expect(compactMinutes).toBeGreaterThan(26);
    expect(compactMinutes).toBeLessThan(28);
    expect(standardMinutes).toBeCloseTo(27, 6);
  });

  it('keeps QUICK below SHORT on every circuit with legal single-stop CPU plans', () => {
    for (const track of TRACKS) {
      const laps = raceLapsForPreset(track.id, 'QUICK');
      expect(laps).toBeGreaterThanOrEqual(6);
      expect(laps).toBeLessThan(raceLapsForPreset(track.id, 'SHORT'));
      const seconds = getTrackDefinition(track.id).referenceLapSeconds ?? 90;
      expect(laps * seconds).toBeLessThanOrEqual(Math.max(540, 6 * seconds));
      for (const driver of createAiField(undefined, laps, 'QUICK')) {
        expect(driver.pitPlan).toHaveLength(1);
        expect(driver.plannedPitLap).toBeGreaterThanOrEqual(2);
        expect(driver.plannedPitLap).toBeLessThanOrEqual(laps - 3);
        expect(driver.nextCompound).not.toBe(driver.tire.compound);
      }
    }
  });

  it('uses the standard duration for the default race', () => {
    expect(DEFAULT_RACE_SETUP.raceLength).toBe('STANDARD');
    expect(DEFAULT_RACE_SETUP.totalLaps).toBe(
      raceLapsForPreset('pitwall-gp', 'STANDARD'),
    );
  });
});
