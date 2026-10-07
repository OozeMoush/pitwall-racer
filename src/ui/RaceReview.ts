import { lapTyreLabel } from '../simulation/LapRecordModel';
import type { RaceSummary } from '../simulation/RaceSummaryModel';
import { battleGraph, defaultReviewRival, gapLabel, GRAPH, graphX, graphY, resolveReviewRival, pitVisits, reviewCars, TYRE_COLORS, TYRE_NAMES, tyreBests, type BattleGraph } from './RaceReviewModel';
export { defaultReviewRival } from './RaceReviewModel';

const esc = (value: string): string => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const time = (seconds: number): string => `${Math.floor(seconds/60)}:${(seconds%60).toFixed(1).padStart(4,'0')}`;
const lapTime = (seconds?: number): string => seconds === undefined ? '—' : `${Math.floor(seconds/60)}:${(seconds%60).toFixed(3).padStart(6,'0')}`;
const status = (car: ReturnType<typeof reviewCars>[number]): string => car.disqualified ? '失格（DSQ）' : car.retired ? 'リタイア（DNF）' : car.finished ? '完走' : 'あなたの完走時点で走行中';

function renderGraph(graph: BattleGraph, rivalName: string): string {
  let path = '', connected = false, previousLap = -1;
  for (const point of graph.points) {
    if (point.gap === null) { connected = false; continue; }
    if (point.lap < previousLap) connected = false;
    path += `${connected ? 'L' : 'M'}${graphX(point.lap, graph.totalLaps).toFixed(2)},${graphY(point.gap, graph.range).toFixed(2)} `;
    previousLap = point.lap; connected = true;
  }
  const middle = graphY(0, graph.range);
  const yTicks = [-graph.range, -graph.range/2, 0, graph.range/2, graph.range].map(value => {
    const y = graphY(value, graph.range);
    return `<line x1="${GRAPH.left}" x2="${GRAPH.right}" y1="${y}" y2="${y}" class="${value===0?'graph-zero':'graph-grid'}"/><text x="${GRAPH.left-10}" y="${y+4}" text-anchor="end">${value>0?'+':''}${value.toFixed(1)}秒</text>`;
  }).join('');
  const xTicks = Array.from({length:5},(_,index)=>Math.round(graph.totalLaps*index/4)).filter((value,index,all)=>all.indexOf(value)===index).map(value=>`<text x="${graphX(value,graph.totalLaps)}" y="${GRAPH.bottom+22}" text-anchor="middle">${value}周</text>`).join('');
  const markers = graph.markers.map(marker => {
    const x = graphX(marker.lap,graph.totalLaps), y = marker.player ? GRAPH.top-12 : GRAPH.bottom+9;
    const color = marker.event.compound ? TYRE_COLORS[marker.event.compound] : '#acbdcc';
    const shape = `<path d="M${x},${y-5} l-5,9 h10 Z"/>`;
    return `<g fill="${color}" stroke="${marker.player?'#68d6fa':'#d6a4ff'}" stroke-width="1.5"><title>${marker.player?'あなた':esc(rivalName)} · ピット進入 · ${time(marker.event.time)} · ${marker.event.compound ?? '—'}</title><line x1="${x}" x2="${x}" y1="${GRAPH.top}" y2="${GRAPH.bottom}" opacity=".28" stroke-dasharray="${marker.player?'':'4 4'}"/>${shape}</g>`;
  }).join('');
  const enough = graph.points.filter(point=>point.gap!==null).length >= 2;
  return `<svg data-review-graph viewBox="0 0 ${GRAPH.width} ${GRAPH.height}" role="img" aria-label="${esc(rivalName)}との実測タイム差と双方のピット時点"><rect x="${GRAPH.left}" y="${GRAPH.top}" width="${GRAPH.right-GRAPH.left}" height="${middle-GRAPH.top}" fill="#493449" opacity=".3"/><rect x="${GRAPH.left}" y="${middle}" width="${GRAPH.right-GRAPH.left}" height="${GRAPH.bottom-middle}" fill="#23483f" opacity=".35"/>${yTicks}${xTicks}<text x="${GRAPH.right-8}" y="${GRAPH.top+16}" text-anchor="end">あなたが後ろ</text><text x="${GRAPH.right-8}" y="${GRAPH.bottom-10}" text-anchor="end">あなたが前</text><text x="${GRAPH.left}" y="16">あなたのピット</text><text x="${GRAPH.right}" y="${GRAPH.height-5}" text-anchor="end">完了周回 + 周内の進行 →</text>${markers}<path d="${path}" fill="none" stroke="#8edcf0" stroke-width="2.5"/><circle data-review-cursor r="5" fill="#fff" stroke="#101c29" visibility="hidden"/>${!enough?'<text x="400" y="145" text-anchor="middle">比較可能な記録が不足しています</text>':''}</svg>`;
}

export function renderRaceReview(summary: RaceSummary, selectedId = defaultReviewRival(summary)): string {
  const cars = reviewCars(summary), selected = resolveReviewRival(summary,selectedId);
  const rival = cars.find(car=>car.id===selected), player = cars.find(car=>car.id==='player');
  const laps = summary.laps.filter(lap=>lap.driverId==='player' && lap.counted && Number.isFinite(lap.seconds) && lap.seconds>0);
  const best = laps.length ? Math.min(...laps.map(lap=>lap.seconds)) : undefined;
  const buttons = cars.filter(car=>car.id!=='player').map(car=>`<button type="button" data-review-driver="${esc(car.id)}" aria-pressed="${car.id===selected}">P${car.position} ${esc(car.name)}</button>`).join('');
  const rows = cars.map(car=>`<tr><td>P${car.position}</td><th>${esc(car.name)}</th><td>${TYRE_NAMES[car.compound]}</td><td>${car.lapDifference===0?'同一周回':`${car.lapDifference>0?'+':''}${car.lapDifference}周`}</td><td>${status(car)}</td></tr>`).join('');
  const events = pitVisits(summary).filter(visit => visit.driverId === 'player' || visit.driverId === selected).map(visit => `<tr><td>${visit.entryLap === null ? '進入記録なし' : visit.entryLap+'周目'}</td><th>${visit.driverId === 'player' ? 'あなた' : esc(rival?.name ?? '相手')}</th><td>${visit.elapsed === null ? '計測不足・未完了' : visit.elapsed.toFixed(1)+'秒'}</td></tr>`).join('');
  const lapRows = laps.slice(-12).map(lap=>{
    const other=summary.laps.find(row=>row.driverId===selected&&row.lap===lap.lap);
    return `<tr><td>${lap.lap}周</td><td>${lap.seconds.toFixed(3)}s</td><td>${other?.seconds.toFixed(3)??'—'}${other?'s':''}</td><td>${lapTyreLabel(lap.startCompound,lap.endCompound,lap.pitted)}</td><td>${other?lapTyreLabel(other.startCompound,other.endCompound,other.pitted):'—'}</td></tr>`;
  }).join('');
  const bests = tyreBests(summary);
  const tyreCards = (['SOFT','MEDIUM','HARD'] as const).map(compound=>`<div class="review-tyre-best" style="--tyre-color:${TYRE_COLORS[compound]}"><span>${TYRE_NAMES[compound]} <small>${compound}</small></span><strong>${lapTime(bests[compound]?.seconds)}</strong><small>${bests[compound]?`${bests[compound]!.lap}周目`:'対象ラップなし'}</small></div>`).join('');
  const graph = battleGraph(summary,selected);
  return `<section class="race-review" aria-label="レースの振り返り"><header class="review-result"><div><small>レース結果 · ${esc(summary.context.trackId)} · ${esc(summary.context.raceLength ?? '')} ${summary.context.totalLaps}周</small><h1>${player?`${player.position}<span>位 / ${cars.length}台</span>`:'レース記録'}</h1><p>${player?status(player):'記録なし'}${player?.pendingPenaltySeconds?` · 未消化ペナルティ ${player.pendingPenaltySeconds}秒`:''}</p></div><div class="review-metrics"><div><small>最速ラップ</small><strong>${lapTime(best)}</strong></div><div><small>レース時間</small><strong>${time(summary.elapsedSeconds)}</strong></div></div><div class="review-retry"><button type="button" class="review-primary" data-review-retry="same">同じ条件で再挑戦</button><div>${(['SOFT','MEDIUM','HARD'] as const).filter(compound=>compound!==summary.context.startCompound).map(compound=>`<button type="button" data-review-retry="${compound}">${TYRE_NAMES[compound]}で再挑戦</button>`).join('')}</div></div></header>
  <section class="review-tyres" aria-label="タイヤ別最速ラップ">${tyreCards}</section><p class="review-note">タイヤ別最速：交換なし・開始と終了のタイヤが同じ完了ラップ。接触等のクリーン判定は行いません。${summary.omittedLaps?` 記録上限により${summary.omittedLaps}件未保持。最速は保持した記録内です。`:''}</p>
  <section class="review-battle"><div class="review-battle-heading"><h2>${esc(rival?.name??'ライバル')}とのタイム差</h2><span>負：あなたが後ろ / 正：あなたが前</span></div><nav aria-label="比較するライバル">${buttons}</nav>${renderGraph(graph,rival?.name??'相手')}<div class="review-legend"><span>実線・上の印：あなた</span><span>破線・下の印：相手</span><span>▲ ピット進入（1回につき1つ）</span><span>赤 S / 黄 M / 白 H</span></div><div class="review-point-controls"><label>観測点 <input type="range" data-review-point min="0" max="${Math.max(0,graph.points.length-1)}" value="${Math.max(0,graph.points.length-1)}" step="1" aria-label="周回ごとのタイム差を確認" ${graph.points.length?'':'disabled'}></label><output data-review-readout aria-live="polite">グラフをタップ・なぞる、またはスライダーで確認</output></div><p>同じ地点の通過時刻から実測。周回差・計測不足は線を切ります。ピット時点の横位置は観測した走行進行から配置。差の変化には交通・走行・タイヤも影響します。</p></section>
  <p class="review-cutoff">あなたの完走時点の順位です。走行中のCPUはリタイア扱いにしません。失格・未消化ペナルティは別表示です。</p>
  <section class="review-details"><details><summary>ラップ比較 · 直近12周</summary><div class="review-table"><table><thead><tr><th>周</th><th>あなた</th><th>${esc(rival?.name??'相手')}</th><th>あなたのタイヤ</th><th>相手のタイヤ</th></tr></thead><tbody>${lapRows||'<tr><td colspan="5">完了ラップなし</td></tr>'}</tbody></table></div></details><details><summary>全車の順位</summary><div class="review-table"><table><thead><tr><th>順位</th><th>ドライバー</th><th>タイヤ</th><th>周回差</th><th>状態</th></tr></thead><tbody>${rows}</tbody></table></div></details><details><summary>ピット履歴 · あなたと${esc(rival?.name??'相手')}</summary><div class="review-table"><table><thead><tr><th>進入した周</th><th>車</th><th>進入→復帰の所要時間</th></tr></thead><tbody>${events||'<tr><td colspan="3">ピット記録なし</td></tr>'}</tbody></table></div><p>1回のピット進入からコース復帰までの実測時間です。ピットを通らなかった場合との差（純粋なロス）ではありません。</p></details><details><summary>記録を保存・比較条件</summary><button type="button" data-review-download>記録JSONを保存</button><p>比較条件：geometry ${esc(summary.context.trackRevision)} · LINE ${esc(summary.context.line.source)} / ${esc(summary.context.line.fingerprint)} · レース中のライン変更 ${summary.events.filter(event=>event.kind==='LINE_CHANGE').length}回${summary.omittedEvents||summary.omittedLaps?` · 未保持：イベント ${summary.omittedEvents} / ラップ ${summary.omittedLaps}`:''}</p><p>再挑戦は同じコース・グリッド・開始時のCPUライン。ピット時期はFで変更できます。操作とCPUの揺らぎにより結果は変わります。</p></details></section></section>`;
}

/** Bind once after a real review render. Pointer/range updates mutate only the
 * readout and cursor, preserving scroll, focus and open detail sections. */
export function bindRaceReviewInteraction(root: HTMLElement, summary: RaceSummary, selectedId: string): void {
  const graph = battleGraph(summary,selectedId);
  const svg = root.querySelector<SVGSVGElement>('[data-review-graph]');
  const slider = root.querySelector<HTMLInputElement>('[data-review-point]');
  const readout = root.querySelector<HTMLOutputElement>('[data-review-readout]');
  const cursor = root.querySelector<SVGCircleElement>('[data-review-cursor]');
  const show = (index: number): void => {
    const point = graph.points[index]; if (!point || !readout || !cursor) return;
    readout.textContent = `${point.observed ? point.lap.toFixed(2)+'周' : '周回位置不明'} · ${time(point.time)} · ${gapLabel(point.gap)}`;
    if(slider) slider.value=String(index);
    cursor.setAttribute('visibility',point.gap===null?'hidden':'visible');
    cursor.setAttribute('cx',String(graphX(point.lap,graph.totalLaps)));
    cursor.setAttribute('cy',String(graphY(point.gap??0,graph.range)));
  };
  const pointer = (event: PointerEvent): void => {
    if (!svg || !graph.points.length) return;
    const matrix=svg.getScreenCTM(); if(!matrix) return;
    const local=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
    const lap=Math.max(0,Math.min(graph.totalLaps,(local.x-GRAPH.left)/(GRAPH.right-GRAPH.left)*graph.totalLaps));
    let closest=0;
    graph.points.forEach((point,index)=>{if(point.observed && Math.abs(point.lap-lap)<Math.abs(graph.points[closest].lap-lap)) closest=index;});
    show(closest);
  };
  svg?.addEventListener('pointermove',pointer);
  svg?.addEventListener('pointerdown',pointer);
  slider?.addEventListener('input',()=>show(Number(slider.value)));
  show(graph.points.length-1);
}
