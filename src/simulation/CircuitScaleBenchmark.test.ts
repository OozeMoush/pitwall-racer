import { describe, expect, it } from 'vitest';
import { raceLapsForPreset } from '../game/RaceSetup';
import { pitStopTimeLossEstimateSecondsFor } from './PitLaneModel';
import { benchmarkStrategies, strategyRaceProfile } from './StrategySimulator';
import { circuitScalePresetFor, getTrackDefinition } from './TrackModel';

describe('physical circuit scale benchmark', () => {
  it('keeps Compact and Standard race economies coherent on the same duration preset', () => {
    const rows = (['serra-circuit', 'pitwall-gp'] as const).map((trackId) => {
      const definition = getTrackDefinition(trackId);
      const totalLaps = raceLapsForPreset(trackId, 'STANDARD');
      const race = strategyRaceProfile(trackId, totalLaps);
      const strategies = benchmarkStrategies(race);
      const lapSeconds = race.representativeLapSeconds;
      return {
        trackId,
        scale: circuitScalePresetFor(trackId),
        lapSeconds,
        totalLaps,
        raceMinutes: totalLaps * lapSeconds / 60,
        pitLossSeconds: pitStopTimeLossEstimateSecondsFor(trackId),
        pitLossLapRatio: race.pitLossSeconds / lapSeconds,
        strategyEffectScale: race.strategyEffectScale,
        oneTwoGapSeconds: Math.abs(
          strategies.fastestOneStop.totalTime - strategies.fastestTwoStop.totalTime,
        ),
        fastestOneStop: strategies.fastestOneStop.name,
        fastestTwoStop: strategies.fastestTwoStop.name,
      };
    });

    const compact = rows[0];
    const standard = rows[1];
    console.info(`CIRCUIT_SCALE_BENCHMARK ${JSON.stringify(rows)}`);

    expect(compact.scale).toBe('COMPACT');
    expect(standard.scale).toBe('STANDARD');

    // Physical lap scale is independent from session duration.
    expect(Math.abs(compact.raceMinutes - standard.raceMinutes)).toBeLessThan(1);
    expect(compact.totalLaps).toBeGreaterThan(standard.totalLaps * 3);

    // Compact pits are shorter in absolute time, but remain a comparable
    // fraction of a lap instead of consuming half a 20-40 s lap.
    expect(compact.pitLossSeconds).toBeLessThan(standard.pitLossSeconds * 0.4);
    expect(compact.pitLossLapRatio).toBeGreaterThan(0.15);
    expect(compact.pitLossLapRatio).toBeLessThan(0.30);
    expect(standard.pitLossLapRatio).toBeGreaterThan(0.15);
    expect(standard.pitLossLapRatio).toBeLessThan(0.30);

    // Both formats retain a genuine one-stop / two-stop decision.
    expect(compact.oneTwoGapSeconds).toBeLessThan(3);
    expect(standard.oneTwoGapSeconds).toBeLessThan(3);
  });
});
