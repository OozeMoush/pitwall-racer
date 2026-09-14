import type { DriverState } from './RaceModel';

/**
 * The race now has one authoritative source of truth for AI position: the
 * physical Rapier bodies. Older builds tried to solve traffic twice by moving
 * abstract driver progress/lane values before the physics step. That could
 * manufacture impossible ±48 m lanes and, more importantly, made a close pack
 * collapse into an artificial parade because the physical controller was then
 * steering from already-rewritten race positions.
 *
 * AI cars deliberately do not collide with one another in Rapier; wheel-to-
 * wheel spacing and overtakes are handled by DynamicAiController from their
 * actual physical positions. Keep this compatibility function as a no-op so
 * callers/tests do not need a broad refactor, but never teleport or lane-snap
 * a professional driver here again.
 */
export function resolveAiOccupancy(drivers: DriverState[], _dt?: number): DriverState[] {
  return drivers;
}
