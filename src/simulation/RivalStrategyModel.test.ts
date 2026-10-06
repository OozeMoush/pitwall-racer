import { describe, expect, it } from 'vitest';
import { compareRivalPace, rivalNeighbours, RivalPitObserver, type RivalCar, type PaceLap } from './RivalStrategyModel';
const lap = (lap: number, lapTime = 30, pitted = false): PaceLap => ({ lap, lapTime, pitted });
const car = (id: string, lap = 3, progress = 0.5): RivalCar => ({ id, name: id, lap, progress, compound: 'MEDIUM', phase: 'NONE' });

describe('rival pace evidence', () => {
  it('averages matching recent completed laps with an explicit player-relative sign', () => {
    expect(compareRivalPace([lap(2), lap(3), lap(4)], [lap(2,31),lap(3,32),lap(4,33)],4)).toEqual({ delta:2,laps:[2,3,4] });
    expect(compareRivalPace([lap(2,32)], [lap(2,30)],2).delta).toBe(-2);
  });
  it('rejects start, pit, out, invalid, nonfinite and unfinished laps without old-data fallback', () => {
    const a = [lap(1),lap(2),lap(3,40,true),lap(4),{...lap(5),paceValid:false},lap(6,NaN),lap(7)];
    const b = Array.from({length:7},(_,i)=>lap(i+1,31));
    expect(compareRivalPace(a,b,6)).toEqual({delta:undefined,laps:[]});
    expect(compareRivalPace(a,b,3)).toEqual({delta:1,laps:[2]});
    expect(compareRivalPace([lap(2)], [{...lap(2),valid:false}],2).delta).toBeUndefined();
    expect(compareRivalPace([lap(2)], [lap(3)],3).delta).toBeUndefined();
    expect(compareRivalPace([lap(2,0)], [lap(2)],2).delta).toBeUndefined();
  });
  it('excludes the out lap for either participant and includes the next clean lap', () => {
    const a = [lap(2),lap(3),lap(4),lap(5)];
    const b = [lap(2,40,true),lap(3),lap(4,31),lap(5,31)];
    expect(compareRivalPace(a,b,4)).toEqual({delta:1,laps:[4]});
  });
});
describe('classification neighbours', () => {
  it('distinguishes a timing-line crossing from a whole lap deficit', () => {
    expect(rivalNeighbours([car('a',4,0.01),car('player',3,0.99),car('b',3,0.9)]).map(row=>row.lapped)).toEqual([false,false]);
    expect(rivalNeighbours([car('a',5),car('player',3),car('b',2)]).map(row=>row.lapped)).toEqual([true,true]);
    expect(rivalNeighbours([car('player')]).every(row=>row.car===undefined)).toBe(true);
  });
});
describe('observed rival pit notifications', () => {
  it('deduplicates phases, follows a stopping rival after rank changes, expires and resets', () => {
    const observer = new RivalPitObserver(); const a = car('a');
    observer.update([a],['a'],0);
    a.phase='TRANSIT_IN';observer.update([a],['a'],1);
    observer.update([a],['a'],2);
    expect(observer.visible(2)).toEqual([{id:'a',text:'a · PIT IN',until:5}]);
    a.phase='SERVICE';observer.update([a],[],3);
    expect(observer.visible(3)[0].text).toBe('a · PIT BOX');
    a.phase='TRANSIT_OUT';a.compound='HARD';observer.update([a],[],4);
    expect(observer.visible(4)[0].text).toBe('a · TYRES HARD · PIT OUT');
    a.phase='NONE';observer.update([a],[],5);
    expect(observer.visible(5)[0].text).toBe('a · REJOINED · HARD');
    expect(observer.visible(9)).toEqual([]);
    observer.reset();expect(observer.visible(1)).toEqual([]);
  });
  it('ignores unrelated traffic and keeps at most two brief notifications', () => {
    const observer=new RivalPitObserver();const cars=[car('a'),car('b'),car('c')];
    cars.forEach(car=>car.phase='TRANSIT_IN');observer.update(cars,['a','b'],1);
    expect(observer.visible(1).map(row=>row.id)).toEqual(['a','b']);
  });
});
