export function canRecover(distanceFromLine: number, speed: number): boolean {
  const badlyOffTrack = distanceFromLine >= 115;
  const nearlyStopped = speed <= 16;
  return badlyOffTrack && nearlyStopped;
}
