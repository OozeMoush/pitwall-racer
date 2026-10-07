import { describe, expect, it } from 'vitest';
import { RaceSummaryRecorder, type SummaryCar, type SummaryLap } from '../simulation/RaceSummaryModel';
import { battleGraph, defaultReviewRival, gapLabel, graphX, graphY, GRAPH, resolveReviewRival, tyreBests } from './RaceReviewModel';
import { renderRaceReview } from './RaceReview';
const car=(id:string,progress:number,lap=1):SummaryCar=>({id,name:id,lap,progress,compound:'MEDIUM',wear:0,pitPhase:'NONE',finished:false});
function summary(){
  const recorder=new RaceSummaryRecorder({trackId:'test',trackRevision:'rev',totalLaps:20,startCompound:'MEDIUM',gridOrder:[],line:{source:'AUTO',fingerprint:'test'},rulesVersion:'test'});
  recorder.observe(0,[car('ahead',.2),car('player',.1),car('behind',0)],()=>-2);
  recorder.observe(10,[car('ahead',.6),car('player',.5),car('behind',.4)],()=>undefined);
  recorder.observe(20,[car('ahead',.9),car('player',.8),car('behind',.7)],()=>3);
  recorder.finish('PLAYER_FINISHED',30,[car('ahead',.1,22),car('player',.1,21),car('behind',.9,20)],()=>-2);
  return recorder.snapshot();
}
const lap=(lap:number,seconds:number,startCompound:SummaryLap['startCompound']='MEDIUM',extra:Partial<SummaryLap>={}):SummaryLap=>({driverId:'player',lap,seconds,time:lap*35,startCompound,endCompound:startCompound,pitted:false,counted:true,...extra});
describe('review calculation rules',()=>{
  it('defaults to the classification car ahead, or behind a leading player',()=>{
    const s=summary();expect(defaultReviewRival(s)).toBe('ahead');
    expect(resolveReviewRival(s,'missing')).toBe('ahead');expect(resolveReviewRival(s,'behind')).toBe('behind');
    s.cutoff!.cars.find(c=>c.id==='player')!.position=1;s.cutoff!.cars.find(c=>c.id==='ahead')!.position=2;
    expect(defaultReviewRival(s)).toBe('ahead');
    s.cutoff!.cars=s.cutoff!.cars.filter(c=>c.id==='player');expect(defaultReviewRival(s)).toBe('');
  });
  it('uses all retained laps for compound bests and excludes pit/mixed/non-counted/bad values, not unclean laps',()=>{
    const s=summary();s.laps=[lap(1,30),lap(2,20,'MEDIUM',{pitted:true}),lap(3,10,'MEDIUM',{endCompound:'HARD'}),lap(4,5,'MEDIUM',{counted:false}),lap(5,NaN),lap(6,-1),lap(7,35,'HARD'),lap(8,33,'HARD',{clean:false}),...Array.from({length:20},(_,i)=>lap(i+9,40))];
    const best=tyreBests(s);expect(best.MEDIUM?.lap).toBe(1);expect(best.HARD?.lap).toBe(8);expect(best.SOFT).toBeUndefined();
    s.omittedLaps=3;const html=renderRaceReview(s);
    expect(html).toContain('0:30.000');expect(html).toContain('保持した記録内');expect(html).toContain('対象ラップなし');
    expect(html).not.toContain('<details open');
  });
  it('plots player lap progression, signed observed gaps and separate paths across missing/lapped data',()=>{
    const s=summary(),g=battleGraph(s,'ahead');
    [.1,.5,.8,20].forEach((lap,index)=>expect(g.points[index].lap).toBeCloseTo(lap));expect(g.points.map(p=>p.gap)).toEqual([-2,null,3,null]);
    expect(graphY(-2,g.range)).toBeLessThan(graphY(0,g.range));expect(graphY(3,g.range)).toBeGreaterThan(graphY(0,g.range));
    expect(graphX(0,20)).toBe(GRAPH.left);expect(graphX(20,20)).toBe(GRAPH.right);
    expect(gapLabel(-2)).toContain('後ろ');expect(gapLabel(3)).toContain('前');expect(gapLabel(null)).toContain('比較なし');
    const html=renderRaceReview(s);expect(html).toContain('M73.38');expect(html).toContain('M97.04');
  });
  it('breaks observations without player progress and does not place an event across recovery',()=>{
    const s=summary();s.samples[1].cars=s.samples[1].cars.filter(c=>c.id!=='player');
    s.events=[{time:15,driverId:'ahead',lap:1,kind:'PIT_IN'}];
    const g=battleGraph(s,'ahead');expect(g.points[1].gap).toBeNull();expect(g.points[1].observed).toBe(false);expect(g.markers).toEqual([]);
    s.samples[1].cars.push({...s.samples[0].cars.find(c=>c.id==='player')!, progress:.05});
    s.events=[{time:5,driverId:'ahead',lap:1,kind:'PIT_IN'}];expect(battleGraph(s,'ahead').markers).toEqual([]);
  });
  it('maps both drivers exact pit timestamps to player progress and leaves unobserved events unplaced',()=>{
    const s=summary();s.events=[{time:5,driverId:'player',lap:1,kind:'PIT_IN',compound:'MEDIUM'},{time:15,driverId:'ahead',lap:1,kind:'REJOIN',compound:'HARD'},{time:-1,driverId:'player',lap:1,kind:'PIT_IN'},{time:40,driverId:'player',lap:1,kind:'REJOIN'}];
    const g=battleGraph(s,'ahead');expect(g.markers).toHaveLength(2);expect(g.markers[0].lap).toBeCloseTo(.3);expect(g.markers[0].player).toBe(true);expect(g.markers[1].lap).toBeCloseTo(.65);expect(g.markers[1].player).toBe(false);
    expect(g.markers[1].event.time).toBe(15);
  });
});
