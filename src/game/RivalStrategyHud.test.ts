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
describe('live rival pace column',()=>{
  it('shows player-minus-rival numeric pace, green when gaining and red when losing',()=>{
    const {game,ai}=fixture();
    expect(game.renderPaceCell(ai[0].id)).toContain('pace-gain');
    expect(game.renderPaceCell(ai[0].id)).toContain('-1.00');
    game.aiLapClocks.get(ai[0].id).laps[0].lapTime=29;
    expect(game.renderPaceCell(ai[0].id)).toContain('pace-loss');
    expect(game.renderPaceCell(ai[0].id)).toContain('+1.00');
    expect(game.renderPaceCell(ai[0].id)).not.toContain('YOU SLOWER');
  });
  it('keeps the latest comparison during pits or lap deficits, and hides outside racing',()=>{
    const {game,ai}=fixture();game.physics.aiPitPhase=()=> 'SERVICE';
    expect(game.renderPaceCell(ai[0].id)).toContain('-1.00');
    ai[0].lap=5;expect(game.renderPaceCell(ai[0].id)).toContain('-1.00');
    game.flow.phase='FINISHED';expect(game.renderPaceCell(ai[1].id)).toContain('>—<');
  });
});
