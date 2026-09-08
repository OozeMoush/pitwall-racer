import { describe, expect, it } from 'vitest';
import { resolveAiOccupancy } from './AiOccupancyModel';
import { createAiField, raceDistance } from './RaceModel';
import { TRACK_LENGTH } from './TrackModel';

describe('AiOccupancyModel', () => {
  it('does not leave cars in the same rendered body volume', () => {
    const field = createAiField().slice(0, 5);
    for (const driver of field) {
      driver.lap = 2;
      driver.progress = 0.42;
      driver.laneOffset = 0;
      driver.speed = 78;
    }

    const resolved = resolveAiOccupancy(field, 1 / 60);

    for (let i = 0; i < resolved.length; i++) {
      for (let j = i + 1; j < resolved.length; j++) {
        const longitudinal = Math.abs(
          raceDistance(resolved[i].lap, resolved[i].progress) - raceDistance(resolved[j].lap, resolved[j].progress),
        ) * TRACK_LENGTH;
        const lateral = Math.abs(resolved[i].laneOffset - resolved[j].laneOffset);
        expect(longitudinal >= 60 || lateral >= 31).toBe(true);
      }
    }
  });

  it('leaves separated cars alone', () => {
    const [a, b] = createAiField();
    a.lap = 2;
    a.progress = 0.6;
    a.laneOffset = -20;
    b.lap = 2;
    b.progress = 0.5;
    b.laneOffset = 20;

    const resolved = resolveAiOccupancy([a, b], 1 / 60);
    expect(resolved[0].progress).toBe(a.progress);
    expect(resolved[1].progress).toBe(b.progress);
    expect(resolved[0].laneOffset).toBe(a.laneOffset);
    expect(resolved[1].laneOffset).toBe(b.laneOffset);
  });
});
