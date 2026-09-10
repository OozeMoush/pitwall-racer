import RAPIER from '@dimforge/rapier2d-compat';
import { CoreRaceGame } from './game/CoreRaceGame';
import { setActiveTrack } from './simulation/TrackModel';
import { installHudEnhancer } from './ui/HudEnhancer';
import { showPreRaceMenu } from './ui/PreRaceMenu';
import './style.css';
import './battle-timing.css';
import './timing-highlight-fix.css';

async function bootstrap(): Promise<void> {
  const game = document.querySelector<HTMLElement>('#game');
  const hud = document.querySelector<HTMLElement>('#hud');
  if (!game || !hud) throw new Error('Pitwall Racer root elements are missing');

  hud.innerHTML = '<div class="physics-loading">INITIALIZING PHYSICS…</div>';
  await RAPIER.init();

  const setup = await showPreRaceMenu(hud);
  setActiveTrack(setup.trackId);
  hud.innerHTML = '';
  installHudEnhancer(hud);
  new CoreRaceGame(game, hud, setup);
}

bootstrap().catch((error) => {
  console.error(error);
  const hud = document.querySelector<HTMLElement>('#hud');
  if (hud) hud.innerHTML = '<div class="physics-loading">PHYSICS INIT FAILED</div>';
});
