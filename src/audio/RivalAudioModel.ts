export interface AudioCar { id: string; x: number; y: number; speed: number; }
export interface RivalSound { id: string; distance: number; forward: number; side: number; speed: number; }
export const RIVAL_AUDIO_RADIUS = 45;
export const RIVAL_AUDIO_VOICES = 2;

/** Physical neighbours, independent of race rank, laps, traffic pressure or planned pit stops. */
export function nearestRivalSounds(player: { x: number; y: number; heading: number }, cars: readonly AudioCar[]): RivalSound[] {
  if (![player.x, player.y, player.heading].every(Number.isFinite)) return [];
  const cos = Math.cos(player.heading); const sin = Math.sin(player.heading);
  return cars.filter(c => [c.x, c.y, c.speed].every(Number.isFinite)).map(c => {
    const dx = c.x - player.x; const dy = c.y - player.y;
    return { id: c.id, distance: Math.hypot(dx, dy), forward: dx * cos + dy * sin,
      side: -dx * sin + dy * cos, speed: Math.max(0, c.speed) };
  }).filter(c => c.distance < RIVAL_AUDIO_RADIUS)
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id)).slice(0, RIVAL_AUDIO_VOICES);
}

export function rivalAudioParameters(rival?: RivalSound): { gain: number; pan: number; frequency: number; cutoff: number } {
  if (!rival || ![rival.distance, rival.side, rival.forward, rival.speed].every(Number.isFinite)) {
    return { gain: 0, pan: 0, frequency: 70, cutoff: 600 };
  }
  const proximity = Math.max(0, Math.min(1, 1 - rival.distance / RIVAL_AUDIO_RADIUS));
  return { gain: 0.027 * proximity * proximity,
    // Side is driver's left (+ road normal), so left has negative Web Audio pan.
    pan: -Math.max(-1, Math.min(1, rival.side / Math.max(8, rival.distance))),
    frequency: 65 + Math.min(1, Math.max(0, rival.speed / 112)) * 230,
    cutoff: rival.forward >= 0 ? 1400 : 650 };
}
