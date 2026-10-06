import { expect, it } from 'vitest';
import { wheelCameraZoom } from './CameraZoom';
it('zooms in on wheel up, out on wheel down, and normalizes line scrolling', () => {
  expect(wheelCameraZoom(1, -100)).toBeGreaterThan(1);
  expect(wheelCameraZoom(1, 100)).toBeLessThan(1);
  expect(wheelCameraZoom(1, 3, 1)).toBe(wheelCameraZoom(1, 48));
});
it('bounds visibility during repeated scrolling and ignores invalid input', () => {
  let zoom = 1;
  for (let i = 0; i < 100; i++) zoom = wheelCameraZoom(zoom, -500);
  expect(zoom).toBe(2.5);
  for (let i = 0; i < 100; i++) zoom = wheelCameraZoom(zoom, 500);
  expect(zoom).toBe(0.5);
  expect(wheelCameraZoom(1, NaN)).toBe(1);
});
