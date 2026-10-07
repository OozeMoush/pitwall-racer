import { describe, expect, it } from 'vitest';
import { trackGeometryRevision } from './TrackModel';
import { DRIVER_HISTORY_KEY, DRIVER_HISTORY_LIMITS, loadDriverHistory, saveDriverHistoryLap, historyConditionKey, TimeTrialHistoryRecorder, type DriverLap } from './DriverHistoryStore';
class Storage {
  values = new Map<string,string>(); fail = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if(this.fail) throw Error('quota'); this.values.set(key,value); }
}
const lap = (id: string, seconds = 30, extra: Partial<DriverLap> = {}): DriverLap => ({
  id, sessionId: 'session', lapNumber: 1, recordedAt: 1000, trackId: 'pitwall-gp',
  trackRevision: trackGeometryRevision('pitwall-gp'), mode: 'TIME_TRIAL', rulesVersion: 'test',
  compound: 'SOFT', startWear: 0.02, endWear: 0.05, startTemperature: 98, endTemperature: 102,
  seconds, sectors: [seconds/3,seconds/3,seconds/3], valid: true, reasons: [], ...extra,
});
describe('driver history persistence', () => {
  it('retains chronological attempts including invalid/slower laps, with only genuine clean PB updates', () => {
    const storage = new Storage();
    saveDriverHistoryLap(storage,lap('one',30,{recordedAt:1000}));
    saveDriverHistoryLap(storage,lap('two',31,{recordedAt:2000}));
    saveDriverHistoryLap(storage,lap('invalid',20,{valid:false,reasons:['RECOVERY'],recordedAt:3000}));
    saveDriverHistoryLap(storage,lap('contact',22,{reasons:['WALL_CONTACT'],recordedAt:4000}));
    saveDriverHistoryLap(storage,lap('best',29,{recordedAt:5000}));
    const h = loadDriverHistory(storage).history;
    expect(h.laps.map(l=>l.id)).toEqual(['one','two','invalid','contact','best']);
    expect(h.bests[0].seconds).toBe(29);
    expect(h.updates.map(u=>u.previousSeconds)).toEqual([null,30]);
    expect(loadDriverHistory(storage).status).toBe('OK');
  });
  it('separates geometry, rules, compound, start wear and temperature conditions', () => {
    const storage = new Storage();
    const cases = [{}, {trackRevision:'old'}, {rulesVersion:'different'}, {compound:'HARD' as const}, {startWear:.11}, {startTemperature:104}];
    cases.forEach((extra,i)=>saveDriverHistoryLap(storage,lap('id'+i,30,extra)));
    const h = loadDriverHistory(storage).history;
    expect(h.bests).toHaveLength(6);
    expect(new Set(h.bests.map(historyConditionKey)).size).toBe(6);
    expect(historyConditionKey(lap('a',30,{startWear:.02}))).toBe(historyConditionKey(lap('b',31,{startWear:.09})));
  });
  it('does not import or overwrite legacy TT / PLAYER BEST records or invent dated history', () => {
    const storage = new Storage();
    storage.values.set('pitwall-racer:time-trial:v1:pitwall-gp','legacy-tt');
    storage.values.set('player-line','legacy-line');
    expect(loadDriverHistory(storage).history.laps).toEqual([]);
    saveDriverHistoryLap(storage,lap('new'));
    expect(storage.values.get('pitwall-racer:time-trial:v1:pitwall-gp')).toBe('legacy-tt');
    expect(storage.values.get('player-line')).toBe('legacy-line');
  });
  it('deduplicates finished lap ids and does not replace a PB with an equal lap', () => {
    const storage = new Storage();
    saveDriverHistoryLap(storage,lap('id'));
    expect(saveDriverHistoryLap(storage,lap('id')).status).toBe('DUPLICATE');
    saveDriverHistoryLap(storage,lap('same-time'));
    expect(loadDriverHistory(storage).history.laps).toHaveLength(2);
    expect(loadDriverHistory(storage).history.updates).toHaveLength(1);
  });
  it('bounds stored attempts without losing an earlier PB anchor', () => {
    const storage = new Storage();
    saveDriverHistoryLap(storage,lap('old-best',20));
    for(let i=0;i<DRIVER_HISTORY_LIMITS.laps+2;i++) saveDriverHistoryLap(storage,lap('lap'+i,30));
    const h = loadDriverHistory(storage).history;
    expect(h.laps).toHaveLength(DRIVER_HISTORY_LIMITS.laps);
    expect(h.omittedLaps).toBe(3);
    expect(h.bests[0].seconds).toBe(20);
    saveDriverHistoryLap(storage,lap('slower',25));
    expect(loadDriverHistory(storage).history.updates).toHaveLength(1);
  });
  it('bounds update history and condition anchors with explicit omission counters', () => {
    const storage = new Storage();
    for(let i=0;i<DRIVER_HISTORY_LIMITS.updates+2;i++) saveDriverHistoryLap(storage,lap('pb'+i,1000-i));
    let h = loadDriverHistory(storage).history;
    expect(h.updates).toHaveLength(DRIVER_HISTORY_LIMITS.updates); expect(h.omittedUpdates).toBe(2);
    for(let i=0;i<DRIVER_HISTORY_LIMITS.bests+1;i++) saveDriverHistoryLap(storage,lap('rev'+i,30,{trackRevision:'rev'+i}));
    h=loadDriverHistory(storage).history;
    expect(h.bests).toHaveLength(DRIVER_HISTORY_LIMITS.bests); expect(h.omittedBests).toBe(2);
  });
  it.each(['{broken', JSON.stringify({version:2})])('preserves unreadable or future data without overwriting it: %s', raw => {
    const storage=new Storage(); storage.values.set(DRIVER_HISTORY_KEY,raw);
    expect(saveDriverHistoryLap(storage,lap('new')).status).toBe(raw.startsWith('{broken')?'CORRUPT':'UNSUPPORTED');
    expect(storage.values.get(DRIVER_HISTORY_KEY)).toBe(raw);
  });
  it('rejects invalid numbers and malformed persisted rows', () => {
    const storage=new Storage();
    expect(saveDriverHistoryLap(storage,lap('bad',NaN)).status).toBe('INVALID');
    expect(saveDriverHistoryLap(storage,lap('bad',30,{startWear:2})).status).toBe('INVALID');
    expect(saveDriverHistoryLap(storage,lap('bad',30,{sectors:[1,2,3]})).status).toBe('INVALID');
    saveDriverHistoryLap(storage,lap('one'));
    const raw=JSON.parse(storage.values.get(DRIVER_HISTORY_KEY)!);raw.laps[0].recordedAt='unknown';
    storage.values.set(DRIVER_HISTORY_KEY,JSON.stringify(raw));
    expect(loadDriverHistory(storage).status).toBe('CORRUPT');
  });
  it('reports failed reads/writes without returning an unsaved successful-looking history', () => {
    const storage=new Storage();saveDriverHistoryLap(storage,lap('one'));
    storage.fail=true;const result=saveDriverHistoryLap(storage,lap('two',29));
    expect(result.status).toBe('STORAGE_FAILED');expect(result.history.laps).toHaveLength(1);
    expect(loadDriverHistory(storage).history.bests[0].seconds).toBe(30);
    expect(loadDriverHistory({getItem(){throw Error('blocked');},setItem(){}}).status).toBe('STORAGE_FAILED');
  });
});
it('records completion once, retains accumulated reasons and resets them for a new attempt', () => {
  const recorder=new TimeTrialHistoryRecorder('fixed');
  recorder.begin('pitwall-gp','SOFT',.02,98);
  recorder.flag('WALL_CONTACT');recorder.flag('TRACK_LIMITS');recorder.flag('WALL_CONTACT');
  const completed=recorder.finish(30,[10,10,10],true,.05,102,1234)!;
  expect(completed.reasons).toEqual(['WALL_CONTACT','TRACK_LIMITS']);expect(completed.id).toBe('fixed:1');
  expect(recorder.finish(30,[10,10,10],true,.05,102,1234)).toBeUndefined();
  recorder.begin('pitwall-gp','SOFT',.05,102);
  expect(recorder.finish(0,undefined,false,.05,102)).toBeUndefined();
  expect(recorder.finish(30,[10,10,10],true,.08,105,1235)?.reasons).toEqual([]);
  recorder.begin('pitwall-gp','SOFT',.08,105);recorder.flag('RECOVERY');
  recorder.begin('pitwall-gp','SOFT',.08,105); // Unfinished prior attempt is not a completed lap.
  expect(recorder.finish(30,undefined,false,.1,105,1236)?.reasons).toEqual(['TIMING_INCOMPLETE']);
});
