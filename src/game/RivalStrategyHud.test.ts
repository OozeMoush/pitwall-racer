import { describe, expect, it } from 'vitest';
import { CoreRaceGame } from './CoreRaceGame';
import { RivalPitObserver } from '../simulation/RivalStrategyModel';
import { createAiField } from '../simulation/RaceModel';
import { createTire } from '../simulation/TireModel';
const history = [{lap:2,lapTime:30,pitted:false,valid:true}];
function fixture() {
  const ai=createAiField().slice(0,2);
  ai.forEach(driver=>{driver.lap=3;driver.progress=0.5;});
  const game=Object.assign(Object.create(CoreRaceGame.prototype),{
    ai,lap:3,trackProgress:0.5,tire:createTire('MEDIUM'),flow:{phase:'RACING'},
    timing:{raceTime:50},lapHistory:history,
    aiLapClocks:new Map(ai.map(driver=>[driver.id,{laps:[{...history[0],lapTime:31}]}])),
    rivalPits:new RivalPitObserver(),physics:{aiPitPhase:()=> 'NONE'},
  }) as any;
  const standings=[{id:ai[0].id,name:ai[0].name,lap:3,progress:0.6},{id:'player',name:'YOU',lap:3,progress:0.5},{id:ai[1].id,name:ai[1].name,lap:3,progress:0.4}];
  return {game,ai,standings};
}
describe('live rival HUD integration',()=>{
  it('shows current classification opponents, actual tyres and sample evidence without future plans',()=>{
    const {game,ai,standings}=fixture();
    ai[0].name='<script>';ai[0].pitLap=99;ai[0].nextCompound='HARD';
    const html=game.renderRivalStrategy(standings);
    expect(html).toContain('YOU FASTER');expect(html).toContain('L2 (1)');
    expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('L99');
    expect(html).not.toContain('HARD');
  });
  it('suppresses pace for observed pit activity and whole-lap deficits, and hides outside racing',()=>{
    const {game,standings}=fixture();game.physics.aiPitPhase=()=> 'SERVICE';
    expect(game.renderRivalStrategy(standings)).toContain('PACE — · IN PIT');
    standings[0].lap=5;
    expect(game.renderRivalStrategy(standings)).toContain('LAPS AHEAD');
    game.flow.phase='FINISHED';expect(game.renderRivalStrategy(standings)).toBe('');
  });
});
