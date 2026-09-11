import { DEFAULT_RACE_SETUP, LAP_OPTIONS, type RaceSetup } from '../game/RaceSetup';
import { TRACKS, type TrackDefinition, type TrackId } from '../simulation/TrackModel';
import type { Compound } from '../simulation/TireModel';

export function showPreRaceMenu(root: HTMLElement): Promise<RaceSetup> {
  let selectedTrack: TrackId = DEFAULT_RACE_SETUP.trackId;
  let selectedCompound: Compound = DEFAULT_RACE_SETUP.startCompound;
  let selectedLaps = DEFAULT_RACE_SETUP.totalLaps;

  root.innerHTML = `<div class="pre-race-shell">
    <div class="pre-race-panel">
      <header class="pre-race-header">
        <div><small>PITWALL RACER</small><h1>RACE WEEKEND</h1></div>
        <p>One-shot qualifying sets the grid. Then manage the start, tyres and race pace over the full distance.</p>
      </header>

      <section class="setup-section">
        <div class="setup-title"><b>01 · CIRCUIT</b><span>Choose the kind of race you want.</span></div>
        <div class="track-choice-grid">
          ${TRACKS.map((track) => trackCard(track, track.id === selectedTrack)).join('')}
        </div>
      </section>

      <section class="setup-split">
        <div class="setup-section">
          <div class="setup-title"><b>02 · RACE START TYRE</b><span>Qualifying uses Soft; the race uses your choice.</span></div>
          <div class="tyre-choice-row">
            ${tyreButton('SOFT', 'FAST / SHORT', selectedCompound === 'SOFT')}
            ${tyreButton('MEDIUM', 'BALANCED', selectedCompound === 'MEDIUM')}
            ${tyreButton('HARD', 'SLOWER / LONG', selectedCompound === 'HARD')}
          </div>
        </div>
        <div class="setup-section">
          <div class="setup-title"><b>03 · DISTANCE</b><span>Long enough for tyre strategy to matter.</span></div>
          <div class="lap-choice-row">
            ${LAP_OPTIONS.map((laps) => `<button class="lap-choice ${laps === selectedLaps ? 'selected' : ''}" data-laps="${laps}"><strong>${laps}</strong><span>LAPS</span></button>`).join('')}
          </div>
        </div>
      </section>

      <footer class="pre-race-footer">
        <div><b>QUALIFYING → RACE</b><span>1 FLYING LAP · GRID START · TWO-COMPOUND RACE</span></div>
        <button class="start-race-button" data-start-race>START WEEKEND</button>
      </footer>
    </div>
  </div>`;

  return new Promise((resolve) => {
    const refreshSelected = (): void => {
      root.querySelectorAll<HTMLElement>('[data-track]').forEach((node) => node.classList.toggle('selected', node.dataset.track === selectedTrack));
      root.querySelectorAll<HTMLElement>('[data-compound]').forEach((node) => node.classList.toggle('selected', node.dataset.compound === selectedCompound));
      root.querySelectorAll<HTMLElement>('[data-laps]').forEach((node) => node.classList.toggle('selected', Number(node.dataset.laps) === selectedLaps));
    };

    root.querySelectorAll<HTMLButtonElement>('[data-track]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedTrack = button.dataset.track as TrackId;
        refreshSelected();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-compound]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedCompound = button.dataset.compound as Compound;
        refreshSelected();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-laps]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedLaps = Number(button.dataset.laps);
        refreshSelected();
      });
    });
    root.querySelector<HTMLButtonElement>('[data-start-race]')?.addEventListener('click', () => {
      root.innerHTML = '';
      resolve({ trackId: selectedTrack, startCompound: selectedCompound, totalLaps: selectedLaps });
    }, { once: true });
  });
}

function trackCard(track: TrackDefinition, selected: boolean): string {
  return `<button class="track-choice ${selected ? 'selected' : ''}" data-track="${track.id}">
    <div class="track-preview">${trackPreview(track)}</div>
    <strong>${track.name}</strong>
    <span>${track.subtitle}</span>
  </button>`;
}

function tyreButton(compound: Compound, subtitle: string, selected: boolean): string {
  return `<button class="tyre-choice tyre-${compound.toLowerCase()} ${selected ? 'selected' : ''}" data-compound="${compound}">
    <i></i><strong>${compound}</strong><span>${subtitle}</span>
  </button>`;
}

function trackPreview(track: TrackDefinition): string {
  const points = track.controls;
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  const width = 230;
  const height = 112;
  const pad = 9;
  const scale = Math.min((width - pad * 2) / Math.max(1, maxX - minX), (height - pad * 2) / Math.max(1, maxY - minY));
  const ox = (width - (maxX - minX) * scale) / 2;
  const oy = (height - (maxY - minY) * scale) / 2;
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${(ox + (point.x - minX) * scale).toFixed(1)},${(oy + (point.y - minY) * scale).toFixed(1)}`).join(' ') + ' Z';
  return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
