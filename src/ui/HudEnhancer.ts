interface DriverHudMemory {
  bestLap?: number;
  compounds: string[];
}

export function installHudEnhancer(hud: HTMLElement): () => void {
  let scheduled = false;
  let lastRaceLap = 0;
  let raceSignature = '';
  const driverMemory = new Map<string, DriverHudMemory>();

  const enhance = () => {
    scheduled = false;

    const raceLabel = hud.querySelector<HTMLElement>('.race-id span')?.textContent ?? '';
    const raceMatch = raceLabel.match(/LAP\s+(\d+)\/(\d+)\s+·\s+(.+)$/);
    if (raceMatch) {
      const currentLap = Number(raceMatch[1]);
      const signature = `${raceMatch[2]}:${raceMatch[3]}`;
      if (signature !== raceSignature || (lastRaceLap > 0 && currentLap < lastRaceLap)) {
        driverMemory.clear();
        raceSignature = signature;
      }
      lastRaceLap = currentLap;
    }

    // Remember each driver's actual stint sequence from the live tyre column,
    // and derive personal bests from the completed LAST laps already emitted by
    // CoreRaceGame. This keeps the race UI useful without introducing a second
    // timing source or fake strategy data.
    const rows = Array.from(hud.querySelectorAll<HTMLElement>('.tower > span'));
    for (const row of rows) {
      const name = row.querySelector<HTMLElement>('strong')?.textContent?.trim();
      const tyreNode = row.querySelector<HTMLElement>('em');
      const lastNode = row.querySelector<HTMLElement>('small:not(.tower-best)');
      if (!name || !tyreNode) continue;

      const memory = driverMemory.get(name) ?? { compounds: [] };
      const rawTyre = tyreNode.dataset.currentTyre ?? tyreNode.textContent?.trim().charAt(0) ?? '';
      const currentTyre = /^[SMH]$/.test(rawTyre) ? rawTyre : '';
      if (currentTyre) {
        tyreNode.dataset.currentTyre = currentTyre;
        if (memory.compounds[memory.compounds.length - 1] !== currentTyre) memory.compounds.push(currentTyre);
        tyreNode.textContent = memory.compounds.join('›');
        tyreNode.title = `Tyre history: ${memory.compounds.join(' → ')}`;
      }

      const lastLap = parseLapTime(lastNode?.textContent ?? '');
      if (lastLap !== undefined && lastLap > 10) {
        memory.bestLap = memory.bestLap === undefined ? lastLap : Math.min(memory.bestLap, lastLap);
      }
      driverMemory.set(name, memory);
    }

    const towerHead = hud.querySelector<HTMLElement>('.tower-head');
    if (towerHead) {
      const headings = Array.from(towerHead.querySelectorAll<HTMLElement>('i'));
      if (headings[1]) headings[1].textContent = 'TYRES';
      if (!towerHead.querySelector('.tower-best-head')) {
        const best = document.createElement('i');
        best.className = 'tower-best-head';
        best.textContent = 'BEST';
        towerHead.appendChild(best);
      }
    }

    const bestTimes = [...driverMemory.values()]
      .map((entry) => entry.bestLap)
      .filter((value): value is number => value !== undefined && Number.isFinite(value));
    const sessionBest = bestTimes.length > 0 ? Math.min(...bestTimes) : undefined;

    for (const row of rows) {
      const name = row.querySelector<HTMLElement>('strong')?.textContent?.trim();
      if (!name) continue;
      const memory = driverMemory.get(name);
      let bestNode = row.querySelector<HTMLElement>('.tower-best');
      if (!bestNode) {
        bestNode = document.createElement('small');
        bestNode.className = 'tower-best';
        row.appendChild(bestNode);
      }
      bestNode.textContent = memory?.bestLap === undefined ? '—' : formatLapTime(memory.bestLap);
      bestNode.classList.toggle(
        'timing-purple',
        memory?.bestLap !== undefined && sessionBest !== undefined && Math.abs(memory.bestLap - sessionBest) < 0.0005,
      );
    }

    // The old NEXT STOP card mixed the selected tyre, request state and key
    // binding into one terse sentence. Turn it into an explicit pit command so
    // the player can understand it at a glance while racing.
    const pitPanel = hud.querySelector<HTMLElement>('.core-race-data > div:nth-child(2)');
    const pitHeading = pitPanel?.querySelector<HTMLElement>('small');
    const pitValue = pitPanel?.querySelector<HTMLElement>('b');
    const pitDetail = pitPanel?.querySelector<HTMLElement>('span');
    if (pitPanel && pitHeading && pitValue && pitDetail) {
      const raw = pitDetail.textContent ?? '';
      pitHeading.textContent = 'PIT PLAN';
      pitHeading.style.color = '#d8e0dd';
      pitHeading.style.fontSize = '13px';
      pitDetail.style.fontSize = '13px';
      pitDetail.style.fontWeight = '850';
      pitDetail.style.lineHeight = '1.3';
      pitDetail.style.color = '#e4ece8';
      pitPanel.style.background = '';

      if (raw.startsWith('BOX THIS LAP')) {
        pitDetail.textContent = 'PIT REQUESTED · F: CANCEL';
        pitHeading.style.color = '#ffd166';
        pitDetail.style.color = '#ffd166';
        pitPanel.style.background = 'rgba(255,209,102,.08)';
        pitPanel.title = `Pit this lap for ${pitValue.textContent ?? 'selected tyre'}`;
      } else if (raw.startsWith('PIT BOX')) {
        pitDetail.textContent = raw.replace('PIT BOX', 'STOPPED IN BOX');
        pitHeading.style.color = '#68d7ff';
        pitDetail.style.color = '#d5f4ff';
        pitPanel.style.background = 'rgba(104,215,255,.08)';
        pitPanel.title = 'Pit service in progress';
      } else if (raw.startsWith('PIT LANE')) {
        pitDetail.textContent = raw.replace('PIT LANE', 'IN PIT LANE');
        pitHeading.style.color = '#68d7ff';
        pitDetail.style.color = '#d5f4ff';
        pitPanel.style.background = 'rgba(104,215,255,.08)';
        pitPanel.title = 'Pit stop in progress';
      } else if (raw.startsWith('START')) {
        pitHeading.textContent = 'START TYRE';
        pitDetail.textContent = raw;
        pitPanel.title = 'Race start tyre and grid position';
      } else {
        pitDetail.textContent = 'F: PIT THIS LAP · Q/E/R: CHANGE TYRE';
        pitPanel.title = `Next pit tyre: ${pitValue.textContent ?? 'selected tyre'}`;
      }
    }

    // Legacy energy HUD support remains for the older renderer path.
    const energyValue = hud.querySelector<HTMLElement>('.race-data:not(.core-race-data) > div:nth-child(3) b');
    if (!energyValue || energyValue.querySelector('.energy-meter')) return;

    const match = energyValue.textContent?.match(/(\d+)%/);
    if (!match) return;
    const pct = Math.max(0, Math.min(100, Number(match[1])));
    const modeNode = hud.querySelector<HTMLElement>('.race-data:not(.core-race-data) > div:first-child b');
    const mode = modeNode?.classList.contains('energy-harvest')
      ? 'harvest'
      : modeNode?.classList.contains('energy-deploy')
        ? 'deploy'
        : 'normal';

    energyValue.setAttribute('aria-label', `battery ${pct} percent`);
    energyValue.title = `Battery ${pct}%`;
    energyValue.innerHTML = `<span class="energy-meter energy-${mode}${pct < 20 ? ' energy-low' : ''}"><i style="width:${pct}%"></i></span>`;
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(enhance);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(hud, { childList: true, subtree: true });
  schedule();
  return () => observer.disconnect();
}

function parseLapTime(text: string): number | undefined {
  const value = text.trim();
  if (!value || value === '—' || value.includes('--')) return undefined;
  const parts = value.split(':');
  const seconds = parts.length === 2
    ? Number(parts[0]) * 60 + Number(parts[1])
    : Number(parts[0]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function formatLapTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(3).padStart(6, '0')}`;
}
