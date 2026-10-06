/** Orthographic zoom: wheel up enlarges cars, with bounded visibility. */
export function wheelCameraZoom(zoom: number, deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY)) return zoom;
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 600 : 1);
  return Math.max(0.5, Math.min(2.5, zoom * Math.exp(-Math.max(-300, Math.min(300, pixels)) * 0.0015)));
}

export function installCameraZoom(canvas: HTMLCanvasElement, camera: { zoom: number; updateProjectionMatrix(): void }): () => void {
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) return; // Keep browser pinch/page zoom available.
    event.preventDefault();
    camera.zoom = wheelCameraZoom(camera.zoom, event.deltaY, event.deltaMode);
    camera.updateProjectionMatrix();
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });
  return () => canvas.removeEventListener('wheel', onWheel);
}
