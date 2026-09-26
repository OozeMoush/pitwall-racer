export type LaunchQuality = 'GREAT' | 'GOOD' | 'OK' | 'SLOW';

export interface LaunchResult {
  quality: LaunchQuality;
  label: string;
  reactionSeconds: number;
}

export const AI_START_REACTION_SECONDS = 0.22;

export function evaluateLaunchReaction(reactionSeconds: number): LaunchResult {
  const reaction = Math.max(0, reactionSeconds);
  const milliseconds = Math.round(reaction * 1000);

  if (reaction <= 0.18) {
    return {
      quality: 'GREAT',
      label: `GREAT START · ${milliseconds} ms`,
      reactionSeconds: reaction,
    };
  }
  if (reaction <= 0.26) {
    return {
      quality: 'GOOD',
      label: `GOOD START · ${milliseconds} ms`,
      reactionSeconds: reaction,
    };
  }
  if (reaction <= 0.40) {
    return {
      quality: 'OK',
      label: `REACTION · ${milliseconds} ms`,
      reactionSeconds: reaction,
    };
  }
  return {
    quality: 'SLOW',
    label: `SLOW START · ${milliseconds} ms`,
    reactionSeconds: reaction,
  };
}

export function launchTone(quality: LaunchQuality): 'good' | 'bad' | 'neutral' {
  if (quality === 'GREAT' || quality === 'GOOD') return 'good';
  if (quality === 'SLOW') return 'bad';
  return 'neutral';
}
