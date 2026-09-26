/** Visible wheel geometry in simulation metres; rendering consumes this footprint. */
export const CAR_MODEL_SCALE = 0.68;
export const WHEEL_RADIUS = 0.816;
export const WHEEL_WIDTH = 0.578;
export const WHEEL_RING_RADIUS = 0.833;
export const WHEEL_RING_TUBE = 0.0595;
export const WHEEL_RING_OFFSET = 0.306;
export const WHEEL_CENTRES = [
  { x: 2.924, y: 1.615 },
  { x: 2.924, y: -1.615 },
  { x: -2.465, y: 1.7 },
  { x: -2.465, y: -1.7 },
] as const;
export const WHEEL_HALF_LENGTH = Math.max(WHEEL_RADIUS, WHEEL_RING_RADIUS + WHEEL_RING_TUBE);
export const WHEEL_HALF_WIDTH = Math.max(WHEEL_WIDTH / 2, WHEEL_RING_OFFSET + WHEEL_RING_TUBE);
