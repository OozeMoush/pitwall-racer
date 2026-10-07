import { loadDriverHistory, TT_HISTORY_RULES, historyConditionKey, cleanHistoryLap, type DriverHistory, type DriverLap, type HistoryStatus, type HistoryStorage } from '../simulation/DriverHistoryStore';
import { loadTimeTrialRecord } from '../simulation/TimeTrialRecordStore';
import { trackGeometryRevision, TRACKS, type TrackId } from '../simulation/TrackModel';
import { formatLapTime } from '../simulation/TimingModel';
import { historyGroups, historyGroupSummary } from './DriverHistoryModel';
const esc = (v: string) => v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const date = (n: number) => new Date(n).toLocaleString('ja-JP');
const reasonNames = { TRACK_LIMITS: 'コース外走行', WALL_CONTACT: '壁との接触', CAR_CONTACT: '車との接触', RECOVERY: '復帰操作', TIMING_INCOMPLETE: '区間計測不足' };
export function historyConditionLabel(lap: DriverLap, currentRevision: string): string {
  const wear = Math.min(9, Math.floor(lap.startWear*10))*10;
  const temperature = Math.floor(lap.startTemperature/5)*5;
  return `${lap.trackRevision === currentRevision ? '現在の形状' : '旧形状 '+lap.trackRevision} · ${lap.compound} · 開始摩耗 ${wear}–${wear+10}% · 開始温度 ${temperature}–${temperature+5}℃ · ${lap.rulesVersion === TT_HISTORY_RULES ? '現行の走行条件' : '別の走行条件（'+lap.rulesVersion+'）'}`;
}
function trend(updates: ReturnType<typeof historyGroupSummary>['updates']): string {
  if (!updates.length) return '<p>この条件でのクリーンな記録はまだありません。</p>';
  const times = updates.map(u => u.lap.seconds), dates = updates.map(u => u.lap.recordedAt);
  const low = Math.min(...times)-0.1, high = Math.max(...times)+0.1;
  const first = Math.min(...dates), last = Math.max(...dates);
  const coords = updates.map(u => ({ x: 100+(u.lap.recordedAt-first)/Math.max(1,last-first)*560,
    y: 30+(high-u.lap.seconds)/Math.max(0.2,high-low)*140, update: u }));
  const path = coords.map((c,i) => `${i?'L':'M'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 760 225" role="img" aria-label="自己ベストの更新履歴。下ほど速い"><line x1="100" x2="660" y1="170" y2="170" stroke="#4c647c"/><text x="8" y="38">${high.toFixed(2)}秒</text><text x="8" y="170">${low.toFixed(2)}秒</text><path d="${path}" stroke="#8edcf0" stroke-width="2" fill="none"/>${coords.map(c=>`<circle cx="${c.x}" cy="${c.y}" r="4" fill="#8edcf0"><title>${esc(date(c.update.lap.recordedAt))} · ${c.update.lap.seconds.toFixed(3)}秒</title></circle>`).join('')}<text x="100" y="198">${esc(new Date(first).toLocaleDateString('ja-JP'))}</text><text x="660" y="198" text-anchor="end">${esc(new Date(last).toLocaleDateString('ja-JP'))}</text><text x="660" y="218" text-anchor="end">記録日時 → / 下ほど速い</text></svg>`;
}
export function renderDriverHistory(history: DriverHistory, status: HistoryStatus, trackId: TrackId, selectedKey?: string, legacyBest?: number): string {
  const revision = trackGeometryRevision(trackId);
  const groups = historyGroups(history, trackId);
  const selected = groups.find(g => historyConditionKey(g) === selectedKey)
    ?? groups.find(g => g.trackRevision === revision) ?? groups[0];
  const key = selected ? historyConditionKey(selected) : '';
  const group = historyGroupSummary(history, key);
  const warning = status === 'OK' ? '' : `<p class="history-warning" role="alert">${status === 'UNSUPPORTED' ? '新しい形式の履歴です。この版では読み書きできません。' : status === 'CORRUPT' ? '履歴を読み取れませんでした。元の保存データは上書きしません。' : '履歴の保存領域にアクセスできません。'}</p>`;
  const rows = [...group.laps].reverse().map(l => `<tr><td>${esc(date(l.recordedAt))}<small>セッション ${esc(l.sessionId.slice(-8))} · ${l.lapNumber}周目</small></td><td>${formatLapTime(l.seconds)}</td><td>${cleanHistoryLap(l) ? 'クリーン' : esc(l.reasons.map(r=>reasonNames[r]).join('・') || '無効')}</td><td>${(l.startWear*100).toFixed(1)}→${(l.endWear*100).toFixed(1)}%</td><td>${l.startTemperature.toFixed(1)}→${l.endTemperature.toFixed(1)}℃</td></tr>`).join('');
  const updates = [...group.updates].reverse().map(u => `<tr><td>${esc(date(u.lap.recordedAt))}</td><td>${formatLapTime(u.lap.seconds)}</td><td>${u.previousSeconds === null ? '初回の保持記録' : `${(u.previousSeconds-u.lap.seconds).toFixed(3)}秒速く更新`}</td></tr>`).join('');
  return `<section class="driver-history" aria-label="ドライバー記録"><header><div><small>TIME TRIAL · ドライバー記録</small><h1>走行の積み重ね</h1></div><button type="button" data-history-close>セッション選択へ戻る</button></header>${warning}<div class="history-selectors"><label>コース<select data-history-track>${TRACKS.map(t=>`<option value="${esc(t.id)}" ${t.id===trackId?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label><label>比較する条件<select data-history-condition ${groups.length?'':'disabled'}>${groups.map(g=>`<option value="${esc(historyConditionKey(g))}" ${historyConditionKey(g)===key?'selected':''}>${esc(historyConditionLabel(g,revision))}</option>`).join('') || '<option>記録なし</option>'}</select></label></div><p>タイムトライアル・単独走行・SOFT / PUSH。同じ形状、物理ルール、開始摩耗10%刻み・開始温度5℃刻みで分けます。区間内の条件は完全には一致しません。</p><div class="history-cards"><div><small>この条件の自己ベスト（保持記録）</small><strong>${formatLapTime(group.best?.seconds)}</strong></div><div><small>直近${group.laps.length}周のクリーン率</small><strong>${group.laps.length ? `${group.cleanCount}/${group.laps.length}周 · ${(group.cleanCount/group.laps.length*100).toFixed(0)}%` : '—'}</strong></div><div><small>クリーンな周回のばらつき（標準偏差）</small><strong>${group.deviation === null ? '3周以上で表示' : group.deviation.toFixed(3)+'秒'}</strong><small>対象 ${group.cleanCount}周 · 平均 ${group.mean === null?'—':formatLapTime(group.mean)}</small></div></div><p>クリーン：コース外警告・計測された接触・復帰操作がなく、全区間を計測した有効な完了周。率の分母はこの条件の直近20完了周（無効周も含む）。ばらつきはその中のクリーンな周だけを対象とし、速さの向上を単独で判定しません。未完了の周は含みません。</p><section class="history-trend"><h2>自己ベストの推移</h2>${trend(group.updates)}<details><summary>更新記録 ${group.updates.length}件</summary><div class="history-table"><table><thead><tr><th>日時（端末の時刻）</th><th>自己ベスト</th><th>更新幅</th></tr></thead><tbody>${updates || '<tr><td colspan="3">更新記録なし</td></tr>'}</tbody></table></div></details></section><h2>最近の走行</h2><div class="history-table"><table><thead><tr><th>日時・セッション</th><th>ラップ</th><th>状態</th><th>摩耗</th><th>温度</th></tr></thead><tbody>${rows || '<tr><td colspan="5">記録は今後のTT完了周から残ります。</td></tr>'}</tbody></table></div><p>既存TT最速：${formatLapTime(legacyBest)}。過去の条件が不明なため、新しい推移には混ぜません。従来の最速・PLAYER BESTは保持します。</p><footer><button type="button" data-history-export ${status === 'OK' ? '' : 'disabled'}>履歴JSONを保存</button><p>このブラウザーに保存。端末間の同期はありません。保持上限：全コース合計500周 / 条件別ベスト64件 / 更新200件。未保持：周 ${history.omittedLaps} / 条件 ${history.omittedBests} / 更新 ${history.omittedUpdates}。旧形状は別の条件として表示します。</p></footer></section>`;
}
export function showDriverHistory(root: HTMLElement, storage: HistoryStorage, initialTrack: TrackId): Promise<void> {
  let track = initialTrack, key: string | undefined;
  return new Promise(resolve => {
    const render = (focusSelector?: string) => {
      const loaded = loadDriverHistory(storage);
      root.innerHTML = renderDriverHistory(loaded.history, loaded.status, track, key, loadTimeTrialRecord(storage, track).bestLap);
      root.querySelector('[data-history-close]')?.addEventListener('click', () => resolve(), { once: true });
      root.querySelector<HTMLSelectElement>('[data-history-track]')?.addEventListener('change', event => {
        track = (event.target as HTMLSelectElement).value as TrackId; key = undefined; render('[data-history-track]');
      });
      root.querySelector<HTMLSelectElement>('[data-history-condition]')?.addEventListener('change', event => {
        key = (event.target as HTMLSelectElement).value; render('[data-history-condition]');
      });
      if (focusSelector) root.querySelector<HTMLElement>(focusSelector)?.focus();
      const exportButton = root.querySelector<HTMLButtonElement>('[data-history-export]');
      if (exportButton) {
        exportButton.disabled = loaded.status !== 'OK';
        exportButton.addEventListener('click', () => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(loaded.history,null,2)], { type: 'application/json' }));
          const a = document.createElement('a'); a.href = url; a.download = 'pitwall-driver-history.json'; a.click(); URL.revokeObjectURL(url);
        });
      }
    };
    render();
  });
}
