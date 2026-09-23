import RAPIER from '@dimforge/rapier2d-compat';
import { CoreRaceGame } from './game/CoreRaceGame';
import {
  runQualifyingSession,
  runTimeTrialSession,
} from './game/QualifyingGame';
import { installReferenceLineCalibration } from './simulation/ReferenceLineCalibration';
import { activateStoredRacingLine } from './simulation/RacingLineActivation';
import { setActiveTrack } from './simulation/TrackModel';
import { installHudEnhancer } from './ui/HudEnhancer';
import { installRacePauseController } from './ui/RacePauseController';
import { showPreRaceMenu } from './ui/PreRaceMenu';
import './style.css';
import './battle-timing.css';
import './timing-highlight-fix.css';
import './weekend.css';
import './pause.css';

async function bootstrap(): Promise<void> {
  const game = document.querySelector<HTMLElement>('#game');
  const hud = document.querySelector<HTMLElement>('#hud');
  if (!game || !hud) throw new Error('Pitwall Racer root elements are missing');

  hud.innerHTML = '<div class="physics-loading">INITIALIZING PHYSICS…</div>';
  await RAPIER.init();

  // Reference laps are cached on first use by qualifying and race AI. Make the
  // miniature Pitwall trajectory physically reachable before either session can
  // request that cache; the calibration changes line geometry only, never car
  // power, grip or tyre behaviour.
  installReferenceLineCalibration();

  const setup = await showPreRaceMenu(hud);
  setActiveTrack(setup.trackId);
  activateStoredRacingLine(window.localStorage, setup.trackId);

  const raceSetup = setup.timeTrial
    ? await (async () => {
        await runTimeTrialSession(game, hud, setup);
        // Time Trial exists specifically to update the PLAYER trace; activate
        // the latest stored asset before launching the P8 test race.
        activateStoredRacingLine(window.localStorage, setup.trackId);
        return {
          ...setup,
          qualifyingTime: undefined,
          gridOrder: undefined,
        };
      })()
    : setup.skipQualifying
      ? {
          ...setup,
          qualifyingTime: undefined,
          gridOrder: undefined,
        }
      : await (async () => {
          const qualifying = await runQualifyingSession(game, hud, setup);
          // A clean qualifying lap can become the PLAYER racing-line source for
          // the race immediately in the same weekend. Re-read storage after it.
          activateStoredRacingLine(window.localStorage, setup.trackId);
          return {
            ...setup,
            qualifyingTime: qualifying.playerTime,
            gridOrder: qualifying.gridOrder,
          };
        })();

  hud.innerHTML = '';
  installHudEnhancer(hud);
  // Install before CoreRaceGame creates its RAF loop so P/Escape can freeze
  // simulation time and present the live timing tower as a proper pause screen.
  installRacePauseController(game, hud);
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
