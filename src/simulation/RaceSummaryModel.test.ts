import { describe, expect, it, vi } from 'vitest';
import { RaceSummaryRecorder, summaryFingerprint, type SummaryCar, type SummaryContext } from './RaceSummaryModel';
const context: SummaryContext = { trackId:'pitwall',trackRevision:'rev-1',totalLaps:48,startCompound:'MEDIUM',gridOrder:['a','player'],line:{source:'AUTO',fingerprint:'base'},rulesVersion:'core-dry-v1' };
const car=(id:string,lap=2,progress=0.5):SummaryCar=>({id,name:id,lap,progress,compound:'MEDIUM',wear:0.3,pitPhase:'NONE',finished:false});
describe('bounded race summary observation',()=>{
  it('samples at 1 Hz, captures exact physical transitions and only actual tyre changes',()=>{
    const recorder=new RaceSummaryRecorder(context);const a=car('a');const cars=[car('player'),a];
    recorder.observe(0,cars,()=>undefined);a.pitPhase='TRANSIT_IN';recorder.observe(0.01,cars,()=>undefined);
    a.pitPhase='SERVICE';recorder.observe(0.02,cars,()=>undefined);
    a.pitPhase='TRANSIT_OUT';a.compound='HARD';recorder.observe(0.03,cars,()=>undefined);
    a.pitPhase='NONE';recorder.observe(0.04,cars,()=>undefined);recorder.observe(0.05,cars,()=>undefined);
    expect(recorder.snapshot().samples).toHaveLength(1);
    expect(recorder.snapshot().events.map(row=>[row.kind,row.compound,row.time])).toEqual([['PIT_IN','MEDIUM',0.01],['SERVICE','MEDIUM',0.02],['PIT_OUT','HARD',0.03],['REJOIN','HARD',0.04]]);
    recorder.observe(1,cars,()=>-2);
    expect(recorder.snapshot().samples[1].cars.find(row=>row.id==='a')?.gapToPlayerSeconds).toBe(-2);
  });
  it('distinguishes crossing the timing line from lapping and retains DSQ/unfinished cutoff truth',()=>{
    const recorder=new RaceSummaryRecorder(context);
    const player={...car('player',3,0.99),disqualified:true,pendingPenaltySeconds:5};
    recorder.finish('PLAYER_FINISHED',4,[player,car('a',4,0.01),car('b',2,0.2)],()=>NaN);
    const result=recorder.snapshot();expect(result.cutoff?.cars.find(row=>row.id==='a')?.lapDifference).toBe(0);
    expect(result.cutoff?.cars.find(row=>row.id==='b')?.lapDifference).toBe(-1);
    expect(result.cutoff?.cars.find(row=>row.id==='a')?.gapToPlayerSeconds).toBeNull();
    expect(result.cutoff?.cars.find(row=>row.id==='player')).toMatchObject({disqualified:true,pendingPenaltySeconds:5});
    expect(result.cutoff?.cars.find(row=>row.id==='a')?.finished).toBe(false);
    recorder.finish('ABORTED',8,[],()=>0);recorder.observe(9,[],()=>0);
    expect(recorder.snapshot()).toEqual(result);
  });
  it('separates counted GP laps from clean evidence and never duplicates them',()=>{
    const recorder=new RaceSummaryRecorder(context);const lap={driverId:'player',lap:1,seconds:30,time:30,startCompound:'MEDIUM' as const,endCompound:'MEDIUM' as const,pitted:false,counted:true,clean:false};
    recorder.recordLap(lap);recorder.recordLap(lap);recorder.recordLap({...lap,lap:2,seconds:NaN});
    expect(recorder.snapshot().laps).toEqual([lap]);
    recorder.lineChanged(4,{source:'PLAYER',fingerprint:'new'});recorder.lineChanged(5,{source:'PLAYER',fingerprint:'new'});
    expect(recorder.snapshot().events).toHaveLength(1);expect(recorder.snapshot().context.line).toEqual(context.line);
  });
  it('bounds a long run, preserves exact event times, copies snapshots and isolates sessions',()=>{
    const recorder=new RaceSummaryRecorder(context);const a=car('a');
    for(let i=0;i<18000;i++){a.pitPhase=i%2?'TRANSIT_IN':'SERVICE';recorder.observe(i,[car('player'),a],()=>-1);}
    const result=recorder.snapshot();expect(result.samples.length).toBeLessThanOrEqual(2048);
    expect(result.events).toHaveLength(512);expect(result.omittedEvents).toBeGreaterThan(0);
    expect(result.events.at(-1)?.time).toBe(17999);expect(result.sampleIntervalSeconds).toBeGreaterThan(1);
    result.context.gridOrder.push('fake');result.samples[0].cars[0].name='fake';
    expect(recorder.snapshot().context.gridOrder).toEqual(context.gridOrder);
    expect(new RaceSummaryRecorder(context).snapshot().samples).toEqual([]);
    recorder.finish('ABORTED',18001,[a],()=>undefined);expect(recorder.snapshot().status).toBe('ABORTED');
  });
  it('fingerprints line contents rather than object identity',()=>{
    expect(summaryFingerprint({points:[1,2]})).toBe(summaryFingerprint({points:[1,2]}));
    expect(summaryFingerprint({points:[1,2]})).not.toBe(summaryFingerprint({points:[1,3]}));
  });
});

describe('summary sampling work budget',()=>{
  it('calls gap measurements at sampling time, not at the 120 Hz physics rate',()=>{
    const recorder=new RaceSummaryRecorder(context,'fixed','2026-10-06T00:00:00Z');let calls=0;
    const cars=[car('player'),...Array.from({length:7},(_,i)=>car(`a-${i}`))];
    for(let tick=0;tick<12000;tick++)recorder.observe(tick/120,cars,()=>{calls++;return -1;});
    expect(recorder.snapshot().samples).toHaveLength(100);expect(calls).toBe(700);
  });
});

describe('HTTP-origin summary identity',()=>{
  it('records independent sessions when crypto.randomUUID is unavailable',()=>{
    vi.stubGlobal('crypto',{});
    try {
      const a=new RaceSummaryRecorder(context).snapshot();
      const b=new RaceSummaryRecorder(context).snapshot();
      expect(a.sessionId).not.toBe(b.sessionId);expect(a.sessionId).toMatch(/^race-/);
    } finally { vi.unstubAllGlobals(); }
  });
});
