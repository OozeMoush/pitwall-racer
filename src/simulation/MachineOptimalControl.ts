import type { MachineBrakeWindow } from './MachineLinePilot';

/**
 * Local brake releases found by full-lap machine search on the first executable
 * Pitwall trajectory. Both candidates stayed inside the strict reference lane
 * envelope for the complete flying lap. No human telemetry is involved.
 */
export const PITWALL_MACHINE_BRAKE_WINDOWS: readonly MachineBrakeWindow[] = Object.freeze([
  { center: 0.500, halfWidth: 0.010, scale: 0.80 },
  { center: 0.560, halfWidth: 0.010, scale: 0.90 },
]);
