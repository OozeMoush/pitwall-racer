export const REPRESENTATIVE_SLIDE_PENALTY_SECONDS = 40;

/**
 * One simple degradation signal shared by live handling and strategy tools.
 * Healthy fresh dry tyres sit above the threshold. As effective grip falls
 * through wear/temperature, the value rises toward 1 and makes over-driving
 * the tyre cost speed rather than merely removing steering authority.
 */
export function degradedTyreSlipFactor(grip: number): number {
  return Math.pow(clamp01((0.98 - grip) / 0.38), 1.30);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
