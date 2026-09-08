export function canRecover(distanceFromLine: number, speed: number): boolean {
  // Recovery is a safety net, not the normal way back to the circuit. Once a
  // car is clearly stranded in the grass, however, the player must not have to
  // wait for an arbitrary almost-zero speed before C starts working.
  const deeplyOffTrack = distanceFromLine >= 72;
  const slowEnoughToResetSafely = speed <= 32;
  return deeplyOffTrack && slowEnoughToResetSafely;
}
