import Phaser from 'phaser';
import { RACING_LINE, sampleTrack } from '../simulation/TrackModel';

const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 1000;

export function drawTrackSurface(scene: Phaser.Scene): void {
  const g = scene.add.graphics().setDepth(0);
  g.fillStyle(0x14251a, 1).fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  // Soft verge / shadow gives the road shape weight against the grass.
  strokeClosedPath(g, 174, 0x0a100c, 0.34);
  strokeClosedPath(g, 162, 0x56615a, 0.55);
  strokeClosedPath(g, 152, 0x34383b, 1);

  // Darkened rubbered-in groove. It is intentionally broad enough that the
  // player can read the natural line without turning it into an arcade guide.
  strokeClosedPath(g, 30, 0x24292a, 0.34);
  strokeClosedPath(g, 2, 0xe9eee8, 0.11);

  // Kerb-like edge accents concentrated around several braking/corner zones.
  drawKerbZone(g, 0.085, 0.205, 70);
  drawKerbZone(g, 0.285, 0.405, 70);
  drawKerbZone(g, 0.545, 0.665, 70);
  drawKerbZone(g, 0.785, 0.9, 70);

  const start = sampleTrack(0);
  const nx = -Math.sin(start.heading);
  const ny = Math.cos(start.heading);
  g.lineStyle(4, 0xffffff, 0.9);
  g.lineBetween(start.x - nx * 74, start.y - ny * 74, start.x + nx * 74, start.y + ny * 74);

  // Minimal pit/paddock block for spatial orientation.
  g.fillStyle(0x20292a, 1).fillRoundedRect(585, 235, 430, 126, 12);
  g.fillStyle(0xd9ded6, 0.11).fillRoundedRect(608, 254, 384, 15, 5);
  scene.add.text(626, 294, 'PITWALL // TEST CIRCUIT', {
    fontFamily: 'Arial', fontSize: '22px', color: '#849087',
  }).setDepth(1);
}

function strokeClosedPath(g: Phaser.GameObjects.Graphics, width: number, color: number, alpha: number): void {
  g.lineStyle(width, color, alpha);
  g.beginPath();
  RACING_LINE.forEach((point, index) => index === 0 ? g.moveTo(point.x, point.y) : g.lineTo(point.x, point.y));
  g.closePath();
  g.strokePath();
}

function drawKerbZone(g: Phaser.GameObjects.Graphics, from: number, to: number, offset: number): void {
  const segments = 22;
  for (let i = 0; i < segments; i++) {
    const p0 = from + (to - from) * (i / segments);
    const p1 = from + (to - from) * ((i + 1) / segments);
    for (const side of [-1, 1]) {
      const a = sampleTrack(p0, offset * side);
      const b = sampleTrack(p1, offset * side);
      g.lineStyle(7, i % 2 === 0 ? 0xe8ece8 : 0xdb3f45, 0.95);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
  }
}
