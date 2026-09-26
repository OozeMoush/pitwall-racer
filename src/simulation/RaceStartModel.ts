export type LaunchQuality = 'GREAT' | 'GOOD' | 'OK' | 'SLOW';

export interface LaunchResult {
  quality: LaunchQuality;
  label: string;
  reactionSeconds: number;
  accelerationMultiplier: number;
}

export const AI_START_REACTION_SECONDS = 0.22;
export const LAUNCH_ACCELERATION_EFFECT_SECONDS = 1.6;

export function evaluateLaunchReaction(reactionSeconds: number): LaunchResult {
  const reaction = Math.max(0, reactionSeconds);
  const milliseconds = Math.round(reaction * 1000);
  // Make reaction time visible in the launch itself, not only in the HUD.
  // 220 ms is the CPU benchmark and therefore neutral. Faster reactions get a
  // brief acceleration advantage; slower reactions lose launch performance.
  // The clamp keeps the effect obvious without turning it into a rocket boost.
  const accelerationMultiplier = clamp(
    1 + (AI_START_REACTION_SECONDS - reaction) * 1.4,
    0.82,
    1.18,
  );
  const performancePct = Math.round((accelerationMultiplier - 1) * 100);
  const performanceText = performancePct === 0
    ? ''
    : ` · ${performancePct > 0 ? '+' : ''}${performancePct}% LAUNCH`;

  if (reaction <= 0.18) {
    return {
      quality: 'GREAT',
      label: `GREAT START · ${milliseconds} ms${performanceText}`,
      reactionSeconds: reaction,
      accelerationMultiplier,
    };
  }
  if (reaction <= 0.26) {
    return {
      quality: 'GOOD',
      label: `GOOD START · ${milliseconds} ms${performanceText}`,
      reactionSeconds: reaction,
      accelerationMultiplier,
    };
  }
  if (reaction <= 0.40) {
    return {
      quality: 'OK',
      label: `REACTION · ${milliseconds} ms${performanceText}`,
      reactionSeconds: reaction,
      accelerationMultiplier,
    };
  }
  return {
    quality: 'SLOW',
    label: `SLOW START · ${milliseconds} ms${performanceText}`,
    reactionSeconds: reaction,
    accelerationMultiplier,
  };
}

export function launchTone(quality: LaunchQuality): 'good' | 'bad' | 'neutral' {
  if (quality === 'GREAT' || quality === 'GOOD') return 'good';
  if (quality === 'SLOW') return 'bad';
  return 'neutral';
}


function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
