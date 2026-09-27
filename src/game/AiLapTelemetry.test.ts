import { describe, expect, it } from 'vitest';
import { CoreRaceGame } from './CoreRaceGame';
import { createAiField } from '../simulation/RaceModel';

describe('CoreRaceGame CPU lap telemetry', () => {
  it('records sectors, tyre transition and pit activity for a selected CPU lap', () => {
    const driver = createAiField()[0];
    driver.lap = 1;
    driver.progress = 0.32;
    driver.pitStopIndex = 0;
    driver.tire.compound = 'SOFT';

    let pitting = false;
    const game = Object.assign(Object.create(CoreRaceGame.prototype), {
      ai: [driver],
      totalLaps: 50,
      timing: { raceTime: 0 },
      sessionFastestLap: undefined,
      sessionFastestSectors: [undefined, undefined, undefined],
      physics: {
        isAiPitting: () => pitting,
      },
      aiLapClocks: new Map(),
    }) as any;

    game.resetAiTiming();

    game.timing.raceTime = 7;
    driver.progress = 0.34;
    game.updateAiLapTiming();

    game.timing.raceTime = 15;
    driver.progress = 0.68;
    game.updateAiLapTiming();

    pitting = true;
    game.timing.raceTime = 20;
    driver.progress = 0.82;
    game.updateAiLapTiming();

    driver.lap = 2;
    driver.progress = 0.02;
    driver.pitStopIndex = 1;
    driver.tire.compound = 'HARD';
    game.timing.raceTime = 25;
    game.updateAiLapTiming();

    const clock = game.aiLapClocks.get(driver.id);
    expect(clock.laps).toHaveLength(1);
    expect(clock.laps[0]).toMatchObject({
      lap: 1,
      startCompound: 'SOFT',
      endCompound: 'HARD',
      pitted: true,
      s1: 7,
      s2: 8,
      s3: 10,
      lapTime: 25,
    });
    expect(clock.bestSectors).toEqual([7, 8, 10]);
  });
});
