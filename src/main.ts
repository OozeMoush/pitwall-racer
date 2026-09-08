import RAPIER from '@dimforge/rapier2d-compat';
import { ThreeRaceGame } from './game/ThreeRaceGame';
import { installHudEnhancer } from './ui/HudEnhancer';
import './style.css';

async function bootstrap(): Promise<void> {
  const game = document.querySelector<HTMLElement>('#game');
  const hud = document.querySelector<HTMLElement>('#hud');
  if (!game || !hud) throw new Error('Pitwall Racer root elements are missing');

  hud.innerHTML = '<div class="physics-loading">INITIALIZING PHYSICS…</div>';
  await RAPIER.init();
  hud.innerHTML = '';
  installHudEnhancer(hud);
  new ThreeRaceGame(game, hud);
}

bootstrap().catch((error) => {
  console.error(error);
  const hud = document.querySelector<HTMLElement>('#hud');
  if (hud) hud.innerHTML = '<div class="physics-loading">PHYSICS INIT FAILED</div>';
});
