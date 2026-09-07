import Phaser from 'phaser';
import { RaceScene } from './scenes/RaceScene';
import './style.css';

new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#101713',
  antialias: true,
  pixelArt: false,
  scene: [RaceScene],
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { roundPixels: false },
});
