import { lapTyreLabel } from '../simulation/LapRecordModel';
import type { RaceSummary, SummarySample } from '../simulation/RaceSummaryModel';

const esc = (value: string): string => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const time = (seconds: number): string => `${Math.floor(seconds/60)}:${(seconds%60).toFixed(1).padStart(4,'0')}`;
const status = (car: NonNullable<RaceSummary['cutoff']>['cars'][number]): string => car.disqualified ? 'DSQ' : car.retired ? 'DNF' : car.finished ? 'FINISHED' : 'UNFINISHED AT CUTOFF';

function trace(samples: readonly SummarySample[], id: string, kind: 'position' | 'gap'): string {
  const width=660,height=130,padding=18;
  const duration=Math.max(1,samples.at(-1)?.time ?? 1);
  const values=samples.map(sample=>{
    const car=sample.cars.find(car=>car.id===id);
    return {time:sample.time,value:!car ? null : kind==='position' ? car.position : car.lapDifference!==0 ? null : car.gapToPlayerSeconds};
  });
  const valid=values.flatMap(row=>row.value===null?[]:[row.value]);
  if(valid.length<2) return '<div class="review-empty">比較可能な記録が不足しています</div>';
  const min=kind==='position'?1:Math.min(0,...valid),max=kind==='position'?8:Math.max(0,...valid);
  const scale=Math.max(1,max-min);let path='';let connected=false;
  for(const row of values){
    if(row.value===null){connected=false;continue;}
    const x=padding+(width-padding*2)*row.time/duration;
    const y=padding+(height-padding*2)*(row.value-min)/scale;
    path+=`${connected?'L':'M'}${x.toFixed(1)},${y.toFixed(1)} `;connected=true;
  }
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${kind==='position'?'順位':'実測ギャップ'}の推移"><text x="2" y="13">${min.toFixed(kind==='position'?0:1)}</text><text x="2" y="${height-4}">${max.toFixed(kind==='position'?0:1)}</text><path d="${path}" fill="none" stroke="${kind==='position'?'#77d8ff':'#7ee0a2'}" stroke-width="2"/><text x="${padding}" y="${height-2}">0:00</text><text x="${width-65}" y="${height-2}">${time(duration)}</text></svg>`;
}

export function renderRaceReview(summary: RaceSummary, selectedId: string): string {
  const cars=summary.cutoff?.cars ?? summary.samples.at(-1)?.cars ?? [];
  const rival=cars.find(car=>car.id===selectedId && car.id!=='player') ?? cars.find(car=>car.id!=='player');
  const player=cars.find(car=>car.id==='player');
  const selected=rival?.id;
  const rows=cars.map(car=>`<tr><td>P${car.position}</td><th>${esc(car.name)}</th><td>${car.compound}</td><td>${car.lapDifference===0?'同一周回':`${car.lapDifference>0?'+':''}${car.lapDifference}周`}</td><td>${status(car)}</td></tr>`).join('');
  const buttons=cars.filter(car=>car.id!=='player').map(car=>`<button type="button" data-review-driver="${esc(car.id)}" aria-pressed="${car.id===selected}">${esc(car.name)}</button>`).join('');
  const events=summary.events.filter(event=>event.driverId==='player' || event.driverId===selected).map(event=>`<tr><td>${time(event.time)}</td><td>L${event.lap}</td><th>${esc(cars.find(car=>car.id===event.driverId)?.name ?? event.driverId)}</th><td>${event.kind}</td><td>${event.compound ?? '—'}</td></tr>`).join('');
  const laps=summary.laps.filter(lap=>lap.driverId==='player');
  const lapRows=laps.slice(-12).map(lap=>{
    const other=summary.laps.find(row=>row.driverId===selected && row.lap===lap.lap);
    return `<tr><td>L${lap.lap}</td><td>${lap.seconds.toFixed(3)}s</td><td>${other?.seconds.toFixed(3) ?? '—'}${other?'s':''}</td><td>${lapTyreLabel(lap.startCompound, lap.endCompound, lap.pitted)}</td><td>${other?lapTyreLabel(other.startCompound, other.endCompound, other.pitted):'—'}</td></tr>`;
  }).join('');
  const best=laps.length?Math.min(...laps.map(lap=>lap.seconds)):undefined;
  const lineChanges=summary.events.filter(event=>event.kind==='LINE_CHANGE').length;
  return `<section class="race-review" aria-label="レースの振り返り"><header><small>RACE REVIEW · PLAYER FINISH CUTOFF</small><h1>${player?`P${player.position} · ${status(player)}`:'レース記録'} <span>${time(summary.elapsedSeconds)}</span></h1><p>${esc(summary.context.trackId)} · ${summary.context.totalLaps}周 · START ${summary.context.startCompound} · BEST ${best?.toFixed(3) ?? '—'}s</p></header>
  <div class="review-content"><div class="review-overview"><h2>自分の順位推移</h2>${trace(summary.samples,'player','position')}<p>約${summary.sampleIntervalSeconds}秒ごとの観測。ピット中の一時順位も含みます。</p><table><thead><tr><th>順位</th><th>ドライバー</th><th>タイヤ</th><th>周回差</th><th>終了状態</th></tr></thead><tbody>${rows}</tbody></table><p>プレイヤーの完走時点でレースが停止します。未完走車をDNFとは扱いません。順位は走行距離順で、DSQ・未消化ペナルティは別表示です。</p>${player?.pendingPenaltySeconds?`<p>未消化ペナルティ ${player.pendingPenaltySeconds}秒</p>`:''}</div>
  <div class="review-detail"><h2>ライバルを選んで比較</h2><nav>${buttons}</nav><h3>${esc(rival?.name ?? '—')}との実測ギャップ</h3>${selected?trace(summary.samples,selected,'gap'):''}<p>秒：相手が前なら負、後なら正。同じ地点の通過時刻から計測。周回差・計測不足は線を切り、推定値で補いません。</p><h3>ピット履歴（YOU / ${esc(rival?.name ?? '—')}）</h3><table><thead><tr><th>時刻</th><th>周</th><th>車</th><th>状態</th><th>装着タイヤ</th></tr></thead><tbody>${events || '<tr><td colspan="5">ピット記録なし</td></tr>'}</tbody></table><p>ピット前後の差は交通・走行・タイヤを含む観測です。戦略だけで得した秒数ではありません。比較するときは双方のREJOIN後を基準にしてください。</p><h3>直近12周のラップ（全記録はJSON）</h3><table><thead><tr><th>周</th><th>YOU</th><th>${esc(rival?.name ?? '相手')}</th><th>YOU TYRE</th><th>RIVAL TYRE</th></tr></thead><tbody>${lapRows || '<tr><td colspan="5">完了ラップなし</td></tr>'}</tbody></table><p>通常周・ピット周を区別。数値は完了ラップの実時間で、クリーンペースの平均ではありません。</p></div></div>
  <footer><p>比較条件：geometry ${esc(summary.context.trackRevision)} · LINE ${esc(summary.context.line.source)} / ${esc(summary.context.line.fingerprint)} · レース中のLINE変更 ${lineChanges}回${summary.omittedEvents || summary.omittedLaps?` · 上限による未保持：event ${summary.omittedEvents} / lap ${summary.omittedLaps}`:''}</p><button type="button" data-review-retry="same">同じ開始条件で再挑戦</button>${(['SOFT','MEDIUM','HARD'] as const).filter(compound=>compound!==summary.context.startCompound).map(compound=>`<button type="button" data-review-retry="${compound}">${compound}で再挑戦</button>`).join('')}<button type="button" data-review-download>記録JSONを保存</button><small>再挑戦は同じコース・グリッド・開始時のCPUライン。ピット時期はFで変更できます。操作とCPUの揺らぎにより結果は変わります。</small></footer></section>`;
}
