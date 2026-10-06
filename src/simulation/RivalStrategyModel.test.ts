import { describe, expect, it } from 'vitest';
import { compareRivalPace, rivalNeighbours, RivalPitObserver, type RivalCar, type PaceLap } from './RivalStrategyModel';
const lap = (lap: number, lapTime = 30, pitted = false): PaceLap => ({ lap, lapTime, pitted });
const car = (id: string, lap = 3, progress = 0.5): RivalCar => ({ id, name: id, lap, progress, compound: 'MEDIUM', phase: 'NONE' });

describe('rival pace evidence', () => {
  it('uses the latest shared completed lap and updates every lap', () => {
    expect(compareRivalPace([lap(1),lap(2)], [lap(1,31),lap(2,32)],2)).toEqual({delta:2,laps:[2]});
    expect(compareRivalPace([lap(1)], [lap(1,31)],1)).toEqual({delta:1,laps:[1]});
  });
  it('includes pit, out and invalid laps as requested', () => {
    expect(compareRivalPace([{...lap(3,40,true),valid:false,paceValid:false}], [lap(3,31)],3)).toEqual({delta:-9,laps:[3]});
    expect(compareRivalPace([lap(4)], [lap(4,31)],4)).toEqual({delta:1,laps:[4]});
  });
  it('cannot compare missing, unfinished or invalid numeric times', () => {
    expect(compareRivalPace([lap(2)], [lap(3)],3).delta).toBeUndefined();
    expect(compareRivalPace([lap(2,NaN)], [lap(2)],2).delta).toBeUndefined();
    expect(compareRivalPace([lap(2,0)], [lap(2)],2).delta).toBeUndefined();
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
