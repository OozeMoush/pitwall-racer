import { expect, it } from 'vitest';
import { emptyDriverHistory, saveDriverHistoryLap, loadDriverHistory, historyConditionKey, type DriverLap } from '../simulation/DriverHistoryStore';
import { trackGeometryRevision } from '../simulation/TrackModel';
import { renderDriverHistory } from './DriverHistory';
import { historyGroups, historyGroupSummary } from './DriverHistoryModel';
const lap=(id:string,seconds:number,extra:Partial<DriverLap>={}):DriverLap=>({id,sessionId:'session',lapNumber:1,recordedAt:Number(id)*1000,trackId:'pitwall-gp',trackRevision:trackGeometryRevision('pitwall-gp'),mode:'TIME_TRIAL',rulesVersion:'test',compound:'SOFT',startWear:.01,endWear:.04,startTemperature:98,endTemperature:102,seconds,sectors:[seconds/3,seconds/3,seconds/3],valid:true,reasons:[],...extra});
function history(laps:DriverLap[]){let raw:string|null=null;const storage={getItem:()=>raw,setItem:(_:string,v:string)=>{raw=v;}};laps.forEach(l=>saveDriverHistoryLap(storage,l));return loadDriverHistory(storage).history;}
it('uses all same-condition completed attempts for the clean rate, and clean laps for population deviation',()=>{
  const h=history([lap('1',28),lap('2',30),lap('3',32),lap('4',20,{valid:false,reasons:['RECOVERY']}),lap('5',20,{reasons:['WALL_CONTACT']})]);
  const stats=historyGroupSummary(h,historyConditionKey(h.laps[0]));
  expect(stats.cleanCount).toBe(3);expect(stats.laps).toHaveLength(5);expect(stats.mean).toBe(30);expect(stats.deviation).toBeCloseTo(Math.sqrt(8/3));
  const html=renderDriverHistory(h,'OK','pitwall-gp');expect(html).toContain('3/5周 · 60%');expect(html).toContain('平均 0:30.000');expect(html).toContain('壁との接触');
});
it('limits the statistics window to the last 20 matching attempts, retaining slow clean outliers',()=>{
  const h=history([lap('1',10),...Array.from({length:20},(_,i)=>lap(String(i+2),i===19?300:30))]);
  const stats=historyGroupSummary(h,historyConditionKey(h.laps[0]));
  expect(stats.laps).toHaveLength(20);expect(stats.mean).toBe(43.5);expect(stats.deviation).toBeGreaterThan(50);
});
it('separates older geometry and other conditions and avoids declaring improvement with little evidence',()=>{
  const h=history([lap('1',30,{trackRevision:'old'}),lap('2',35)]);
  expect(historyGroups(h,'pitwall-gp')).toHaveLength(2);
  const html=renderDriverHistory(h,'OK','pitwall-gp',undefined,25);
  expect(html).toContain('旧形状 old');expect(html).toContain('3周以上で表示');expect(html).toContain('0:35.000');
  expect(html).toContain('過去の条件が不明');expect(html).toContain('0:25.000');expect(html).not.toContain('上達しました');
});
it('renders an honest empty state and unreadable-storage warning without inventing history',()=>{
  const html=renderDriverHistory(emptyDriverHistory(),'CORRUPT','pitwall-gp');
  expect(html).toContain('元の保存データは上書きしません');expect(html).toContain('今後のTT完了周');expect(html).toContain('data-history-export disabled');
});
it('escapes recorded identifiers and includes dates, limits and conditions',()=>{
  const h=history([lap('1',30,{trackRevision:'<img onerror="evil">',sessionId:'<script>'})]);
  const html=renderDriverHistory(h,'OK','pitwall-gp');expect(html).not.toContain('<img');expect(html).not.toContain('<script>');expect(html).toContain('&lt;img');
  expect(html).toContain('開始摩耗 0–10%');expect(html).toContain('開始温度 95–100℃');expect(html).toContain('全コース合計500周');expect(html).toContain('初回の保持記録');
});
