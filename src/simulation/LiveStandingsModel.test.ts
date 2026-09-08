import { describe, expect, it } from 'vitest';
import { classifyLivePositions } from './LiveStandingsModel';
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
});
