interface PauseRow {
  position: string;
  tyres: string;
  driver: string;
  gap: string;
  last: string;
  best: string;
}

interface PauseLap {
  lap: number;
  time: number;
  tyre?: string;
}

interface PauseCpuHistory {
  driver: string;
  laps: PauseLap[];
}

/**
 * Pause the race without teaching CoreRaceGame about menu state.
 *
 * The race owns a requestAnimationFrame loop, so intercepting future RAF
 * callbacks freezes the whole simulation deterministically. On resume the held
 * callbacks are scheduled again; CoreRaceGame already caps frame dt, so there
 * is no giant catch-up step after a long pause.
 */
export function installRacePauseController(container: HTMLElement, hud: HTMLElement): () => void {
  const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  const heldFrames = new Map<number, FrameRequestCallback>();
  let nextHeldId = -1;
  let paused = false;
  let overlay: HTMLElement | undefined;

  window.requestAnimationFrame = ((callback: FrameRequestCallback): number => {
    if (!paused) return nativeRequestAnimationFrame(callback);
    const id = nextHeldId--;
    heldFrames.set(id, callback);
    return id;
  }) as typeof window.requestAnimationFrame;

  window.cancelAnimationFrame = ((id: number): void => {
    if (heldFrames.delete(id)) return;
    nativeCancelAnimationFrame(id);
  }) as typeof window.cancelAnimationFrame;

  const decorateControls = () => {
    const controls = hud.querySelector<HTMLElement>('.controls');
    if (!controls || controls.dataset.pauseHint === '1') return;
    controls.textContent = `${controls.textContent ?? ''} · P/ESC PAUSE`;
    controls.dataset.pauseHint = '1';
  };

  const observer = new MutationObserver(decorateControls);
  observer.observe(hud, { childList: true, subtree: true });
  decorateControls();

  const renderOverlay = () => {
    overlay?.remove();
    overlay = document.createElement('div');
    overlay.className = 'race-pause-overlay';

    const raceTitle = hud.querySelector<HTMLElement>('.race-id span')?.textContent?.trim() ?? 'RACE';
    const rows = readRows(hud);
    const playerLaps = readPlayerLaps(hud);
    const timingData = hud.querySelector<HTMLElement>('.pause-timing-data');
    const debugEnabled = timingData?.dataset.debug === '1';
    const cpuHistories = debugEnabled ? readCpuLaps(hud) : [];
    const rowHtml = rows.map((row) => `
      <div class="pause-score-row${row.driver === 'YOU' ? ' you' : ''}">
        <i>${escapeHtml(row.position)}</i>
        <em>${escapeHtml(row.tyres)}</em>
        <strong>${escapeHtml(row.driver)}</strong>
        <span>${escapeHtml(row.gap)}</span>
        <b>${escapeHtml(row.last)}</b>
        <b>${escapeHtml(row.best)}</b>
      </div>`).join('');
    const playerLapHtml = playerLaps.length === 0
      ? '<div class="pause-empty">NO COMPLETED LAPS YET</div>'
      : playerLaps.map((lap) => `
          <div class="pause-lap-row">
            <i>L${lap.lap}</i>
            <em>${escapeHtml(lap.tyre ?? '—')}</em>
            <strong>${formatLapTime(lap.time)}</strong>
          </div>`).join('');
    const cpuLapHtml = cpuHistories.map((history) => `
      <div class="pause-cpu-history">
        <b>${escapeHtml(history.driver)}</b>
        <span>${history.laps.length === 0
          ? '—'
          : history.laps.map((lap) => `L${lap.lap} ${formatLapTime(lap.time)}`).join(' · ')}</span>
      </div>`).join('');

    overlay.innerHTML = `
      <section class="race-pause-card" role="dialog" aria-label="Race paused">
        <header>
          <div><small>RACE PAUSED</small><h2>${escapeHtml(raceTitle)}</h2></div>
          <strong>PAUSED</strong>
        </header>
        <div class="pause-scroll">
          <div class="pause-score-head"><i>P</i><i>TYRES</i><i>DRIVER</i><i>GAP</i><i>LAST</i><i>BEST</i></div>
          <div class="pause-score-list">${rowHtml}</div>
          <section class="pause-history-section">
            <header><b>YOUR LAP HISTORY</b><span>ALL COMPLETED LAPS</span></header>
            <div class="pause-player-lap-list">${playerLapHtml}</div>
          </section>
          ${debugEnabled ? `
            <section class="pause-history-section debug-history">
              <header><b>CPU LAP HISTORY</b><span>F3 DEBUG DATA</span></header>
              <div class="pause-cpu-lap-list">${cpuLapHtml}</div>
            </section>` : ''}
        </div>
        <footer>P / ESC · RESUME${debugEnabled ? ' · CPU HISTORY ENABLED' : ' · F3 BEFORE PAUSE FOR CPU HISTORY'}</footer>
      </section>`;
    container.appendChild(overlay);
  };

  const clearDrivingKeys = () => {
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
      window.dispatchEvent(new KeyboardEvent('keyup', { code }));
    }
  };

  const resume = () => {
    if (!paused) return;
    paused = false;
    document.documentElement.classList.remove('race-paused');
    overlay?.remove();
    overlay = undefined;

    const callbacks = [...heldFrames.values()];
    heldFrames.clear();
    for (const callback of callbacks) nativeRequestAnimationFrame(callback);
  };

  const pause = () => {
    if (paused) return;
    clearDrivingKeys();
    paused = true;
    document.documentElement.classList.add('race-paused');
    renderOverlay();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat || (event.code !== 'KeyP' && event.code !== 'Escape')) return;
    event.preventDefault();
    if (paused) resume();
    else pause();
  };
  window.addEventListener('keydown', onKeyDown, true);

  return () => {
    resume();
    window.removeEventListener('keydown', onKeyDown, true);
    observer.disconnect();
    overlay?.remove();
    window.requestAnimationFrame = nativeRequestAnimationFrame;
    window.cancelAnimationFrame = nativeCancelAnimationFrame;
  };
}

function readRows(hud: HTMLElement): PauseRow[] {
  return Array.from(hud.querySelectorAll<HTMLElement>('.tower > span')).map((row) => {
    const smalls = Array.from(row.querySelectorAll<HTMLElement>('small'));
    const explicitBest = row.querySelector<HTMLElement>('.tower-best')?.textContent?.trim();
    const last = smalls.find((node) => !node.classList.contains('tower-best'))?.textContent?.trim() ?? '—';
    return {
      position: row.querySelector<HTMLElement>('i')?.textContent?.trim() ?? '—',
      tyres: row.querySelector<HTMLElement>('em')?.textContent?.trim() ?? '—',
      driver: row.querySelector<HTMLElement>('strong')?.textContent?.trim() ?? '—',
      gap: row.querySelector<HTMLElement>('b')?.textContent?.trim() ?? '—',
      last,
      best: explicitBest || '—',
    };
  });
}

function readPlayerLaps(hud: HTMLElement): PauseLap[] {
  return Array.from(
    hud.querySelectorAll<HTMLElement>('.pause-player-laps > span'),
  ).map(readLapNode).filter((lap): lap is PauseLap => lap !== undefined);
}

function readCpuLaps(hud: HTMLElement): PauseCpuHistory[] {
  return Array.from(
    hud.querySelectorAll<HTMLElement>('.pause-cpu-laps > div'),
  ).map((row) => ({
    driver: row.dataset.driver ?? 'CPU',
    laps: Array.from(row.querySelectorAll<HTMLElement>('span'))
      .map(readLapNode)
      .filter((lap): lap is PauseLap => lap !== undefined),
  }));
}

function readLapNode(node: HTMLElement): PauseLap | undefined {
  const lap = Number(node.dataset.lap);
  const time = Number(node.dataset.time);
  if (!Number.isFinite(lap) || !Number.isFinite(time) || time <= 0) return undefined;
  return {
    lap,
    time,
    tyre: node.dataset.tyre,
  };
}

function formatLapTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(3).padStart(6, '0')}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
