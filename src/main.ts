import { ThreeRaceGame } from './game/ThreeRaceGame';
import './style.css';

const game = document.querySelector<HTMLElement>('#game');
const hud = document.querySelector<HTMLElement>('#hud');

if (!game || !hud) throw new Error('Pitwall Racer root elements are missing');

new ThreeRaceGame(game, hud);
