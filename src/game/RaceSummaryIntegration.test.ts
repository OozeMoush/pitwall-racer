import { describe, expect, it } from 'vitest';
import { CoreRaceGame } from './CoreRaceGame';
import { RaceSummaryRecorder } from '../simulation/RaceSummaryModel';
import { createTire } from '../simulation/TireModel';
import { setActiveTrack } from '../simulation/TrackModel';
function fixture() {
  setActiveTrack('pitwall-gp');
  return Object.assign(Object.create(CoreRaceGame.prototype),{
    setup:{trackId:'pitwall-gp',totalLaps:6,startCompound:'MEDIUM'},totalLaps:6,
    ai:[],tire:createTire('MEDIUM'),lap:7,trackProgress:0.01,timing:{raceTime:180},
    pitStop:{phase:'IDLE'},flow:{phase:'FINISHED'},trackLimitPenalty:{pendingPitSeconds:5},
    usedCompounds:new Set(['MEDIUM']),raceIntervals:{gapSeconds:()=>undefined},
    summaryRecorder:new RaceSummaryRecorder({trackId:'pitwall-gp',trackRevision:'test',totalLaps:6,startCompound:'MEDIUM',gridOrder:[],line:{source:'AUTO',fingerprint:'auto'},rulesVersion:'test'}),
    reviewDriverId:'player',physics:{aiPitPhase:()=> 'NONE'},
  }) as any;
}
describe('race summary integration lifecycle',()=>{
  it('finalizes actual player outcome once and creates a cached review',()=>{
    const game=fixture();game.recordSummary();
    const result=game.raceSummary;
    expect(result.status).toBe('PLAYER_FINISHED');expect(result.cutoff.cars[0]).toMatchObject({finished:true,disqualified:true,pendingPenaltySeconds:5});
    expect(game.reviewHtml).toContain('DSQ');game.timing.raceTime=190;game.recordSummary();
    expect(game.raceSummary).toBe(result);expect(game.raceSummary.elapsedSeconds).toBe(180);
  });
  it('reset starts an independent session with actual starting tyre and removes the old review',()=>{
    const game=fixture();game.recordSummary();const id=game.raceSummary.sessionId;
    game.tire=createTire('HARD');game.resetSummary();
    expect(game.raceSummary).toBeUndefined();expect(game.reviewHtml).toBe('');
    expect(game.summaryRecorder.snapshot().sessionId).not.toBe(id);
    expect(game.summaryRecorder.snapshot().context.startCompound).toBe('HARD');
    expect(game.summaryRecorder.snapshot().samples).toEqual([]);
  });
  it('does not replace a completed review at refresh rate, preserving scroll and focus',()=>{
    const game=fixture();game.reviewHtml='stable';game.renderedReviewHtml='stable';
    Object.defineProperty(game,'hud',{get:()=>{throw new Error('HUD should not be read');}});
    expect(()=>game.renderHud()).not.toThrow();
  });
});
