import { describe, expect, it } from 'vitest';
import { PLAYER_GRID } from './GridModel';
import { classifyLivePositions } from './LiveStandingsModel';
import { createAiField } from './RaceModel';
import { sampleTrack } from './TrackModel';

describe('classifyLivePositions', () => {
  it('updates position as physical cars pass each other on the same lap', () => {
    const playerBehind = sampleTrack(0.42);
    const rivalAhead = sampleTrack(0.46);
    const initial = classifyLivePositions([
      { id: 'player', name: 'YOU', lap: 3, vehicle: playerBehind },
      { id: 'ai-0', name: 'NOVA', lap: 3, vehicle: rivalAhead },
    ]);
    expect(initial.map((entry) => entry.id)).toEqual(['ai-0', 'player']);

    const playerAhead = sampleTrack(0.49);
    const rivalBehind = sampleTrack(0.47);
    const afterPass = classifyLivePositions([
      { id: 'player', name: 'YOU', lap: 3, vehicle: playerAhead },
      { id: 'ai-0', name: 'NOVA', lap: 3, vehicle: rivalBehind },
    ]);
    expect(afterPass.map((entry) => entry.id)).toEqual(['player', 'ai-0']);
  });

  it('keeps lap count authoritative across the start line', () => {
    const laterLap = sampleTrack(0.03);
    const earlierLap = sampleTrack(0.97);
    const order = classifyLivePositions([
      { id: 'player', name: 'YOU', lap: 5, vehicle: laterLap },
      { id: 'ai-0', name: 'NOVA', lap: 4, vehicle: earlierLap },
    ]);
    expect(order[0].id).toBe('player');
  });

  it('keeps a starter ahead when it crosses from grid lap zero into lap one', () => {
    const crossed = sampleTrack(0.006, -8);
    const waiting = sampleTrack(0.992, 8);
    const order = classifyLivePositions([
      { id: 'ai-0', name: 'NOVA', lap: 1, vehicle: crossed },
      { id: 'ai-1', name: 'APEX', lap: 0, vehicle: waiting },
    ]);
    expect(order.map((entry) => entry.id)).toEqual(['ai-0', 'ai-1']);
  });

  it('starts the player at the back of the eight-car grid', () => {
    const ai = createAiField();
    const order = classifyLivePositions([
      { id: 'player', name: 'YOU', lap: 0, vehicle: sampleTrack(PLAYER_GRID.progress, PLAYER_GRID.laneOffset) },
      ...ai.map((driver) => ({
        id: driver.id,
        name: driver.name,
        lap: driver.lap,
        vehicle: sampleTrack(driver.progress, driver.laneOffset),
      })),
    ]);
    expect(order.at(-1)?.id).toBe('player');
  });
});
