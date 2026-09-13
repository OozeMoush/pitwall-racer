import RAPIER from '@dimforge/rapier2d-compat';
import { CoreRaceGame } from './game/CoreRaceGame';
import { runQualifyingSession } from './game/QualifyingGame';
import { setActiveTrack } from './simulation/TrackModel';
import { installHudEnhancer } from './ui/HudEnhancer';
import { showPreRaceMenu } from './ui/PreRaceMenu';
import './style.css';
import './battle-timing.css';
import './timing-highlight-fix.css';
import './weekend.css';

async function bootstrap(): Promise<void> {
  const game = document.querySelector<HTMLElement>('#game');
  const hud = document.querySelector<HTMLElement>('#hud');
  if (!game || !hud) throw new Error('Pitwall Racer root elements are missing');

  hud.innerHTML = '<div class="physics-loading">INITIALIZING PHYSICS…</div>';
  await RAPIER.init();

  const setup = await showPreRaceMenu(hud);
  setActiveTrack(setup.trackId);

  const qualifying = await runQualifyingSession(game, hud, setup);
  const raceSetup = {
    ...setup,
    qualifyingTime: qualifying.playerTime,
    gridOrder: qualifying.gridOrder,
  };

  hud.innerHTML = '';
  installHudEnhancer(hud);
  const race = new CoreRaceGame(game, hud, raceSetup);

  // CoreRaceGame predates the long-race format and still carries a private
  // 30-lap construction cap. TypeScript `private readonly` is a compile-time
  // property here, so lift that legacy cap immediately after construction.
  // Keeping the override in one visible bootstrap location makes it easy to
  // remove when CoreRaceGame is next refactored without touching race logic.
  Reflect.set(race, 'totalLaps', Math.max(20, Math.min(80, Math.round(raceSetup.totalLaps))));
}

bootstrap().catch((error) => {
  console.error(error);
  const hud = document.querySelector<HTMLElement>('#hud');
  if (hud) hud.innerHTML = '<div class="physics-loading">PHYSICS INIT FAILED</div>';
});
