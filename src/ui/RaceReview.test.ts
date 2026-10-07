import { describe, expect, it } from 'vitest';
import { RaceSummaryRecorder, type SummaryContext, type SummaryCar } from '../simulation/RaceSummaryModel';
import { renderRaceReview } from './RaceReview';
const context:SummaryContext={trackId:'test',trackRevision:'rev',totalLaps:6,startCompound:'MEDIUM',gridOrder:['a','player'],line:{source:'PLAYER',fingerprint:'stored'},rulesVersion:'core-dry-v1'};
const car=(id:string):SummaryCar=>({id,name:id,lap:1,progress:0.1,compound:'MEDIUM',wear:0,pitPhase:'NONE',finished:false});
describe('race review presentation',()=>{
  it('shows observed cutoff status instead of declaring uncompleted opponents DNF',()=>{
    const recorder=new RaceSummaryRecorder(context);recorder.observe(0,[car('player'),car('a')],()=>undefined);
    recorder.finish('PLAYER_FINISHED',30,[{...car('player'),finished:true,disqualified:true},car('a')],()=>undefined);
    const html=renderRaceReview(recorder.snapshot(),'a');
    expect(html).toContain('DSQ');expect(html).toContain('あなたの完走時点で走行中');expect(html).not.toContain('<td>DNF</td>');
    expect(html).toContain('比較可能な記録が不足');expect(html).toContain('ピットを通らなかった場合との差（純粋なロス）ではありません');
    expect(html).toContain('進入→復帰の所要時間');expect(html).toContain('data-review-retry="same"');expect(html).toContain('data-review-download');
  });
  it('escapes imported names and separates matching lap history from observed gap',()=>{
    const recorder=new RaceSummaryRecorder(context);
    const a={...car('a'),name:'<img onerror="evil">'};
    recorder.observe(0,[car('player'),a],()=>-3);recorder.observe(1,[car('player'),a],()=>-2);
    recorder.recordLap({driverId:'player',lap:1,seconds:31,time:31,startCompound:'MEDIUM',endCompound:'MEDIUM',pitted:false,counted:true});
    recorder.recordLap({driverId:'a',lap:1,seconds:33,time:33,startCompound:'MEDIUM',endCompound:'HARD',pitted:true,counted:true});
    recorder.finish('PLAYER_FINISHED',40,[car('player'),a],()=>-2);
    const html=renderRaceReview(recorder.snapshot(),'a');
    expect(html).not.toContain('<img');expect(html).toContain('&lt;img');expect(html).toContain('33.000s');expect(html).toContain('M→H PIT');
    expect(html).toContain('<td>M</td>');expect(html).not.toContain('M→M');
    expect(html).toContain('geometry rev');expect(html).toContain('PLAYER / stored');expect(html).toContain('<svg');
  });
});
