import {
  DEFAULT_RACE_LENGTH,
  DEFAULT_RACE_SETUP,
  RACE_LENGTH_OPTIONS,
  raceLapsForPreset,
  type RaceLengthPreset,
  type RaceSetup,
} from '../game/RaceSetup';
import { loadPlayerRacingLineCandidate } from '../simulation/PlayerRacingLineCandidate';
import {
  saveSelectedRacingLineSource,
  selectedRacingLineSource,
  type SelectableRacingLineSource,
} from '../simulation/RacingLineSelectionStore';
import { TRACKS, type TrackDefinition, type TrackId } from '../simulation/TrackModel';
import type { Compound } from '../simulation/TireModel';

export function showPreRaceMenu(
  root: HTMLElement,
  initial: RaceSetup = DEFAULT_RACE_SETUP,
): Promise<RaceSetup> {
  let selectedTrack: TrackId = initial.trackId;
  let selectedCpuLine: SelectableRacingLineSource = selectedRacingLineSource(
    window.localStorage,
    selectedTrack,
  );
  let selectedCompound: Compound = initial.startCompound;
  let selectedRaceLength: RaceLengthPreset = initial.raceLength ?? DEFAULT_RACE_LENGTH;
  let selectedLaps = initial.raceLength
    ? raceLapsForPreset(selectedTrack, selectedRaceLength)
    : initial.totalLaps;

  root.innerHTML = `<div class="pre-race-shell">
    <div class="pre-race-panel">
      <header class="pre-race-header">
        <div><small>PITWALL RACER</small><h1>RACE WEEKEND</h1></div>
        <p>Choose a Grand Prix session or enter the independent empty-track Time Trial to update PLAYER BEST.</p>
      </header>

      <section class="setup-section">
        <div class="setup-title"><b>01 · CIRCUIT</b><span>Choose the kind of race you want.</span></div>
        <div class="track-choice-grid">
          ${TRACKS.map((track) => trackCard(track, track.id === selectedTrack)).join('')}
        </div>
      </section>

      <section class="setup-section">
        <div class="setup-title"><b>02 · CPU RACING LINE</b><span>Choose the baseline CPU line. Player best improves from clean qualifying or race laps.</span></div>
        <div class="track-choice-grid cpu-line-choice-grid">
          <button class="track-choice cpu-line-choice" data-cpu-line="AUTO">
            <strong>AUTO</strong>
            <span>Current machine-generated baseline</span>
          </button>
          <button class="track-choice cpu-line-choice" data-cpu-line="PLAYER">
            <strong>PLAYER BEST</strong>
            <span data-player-line-status>No clean lap captured yet</span>
          </button>
        </div>
      </section>

      <section class="setup-split">
        <div class="setup-section">
          <div class="setup-title"><b>03 · RACE START TYRE</b><span>Qualifying uses Soft; the race uses your choice.</span></div>
          <div class="tyre-choice-row">
            ${tyreButton('SOFT', 'FAST / SHORT', selectedCompound === 'SOFT')}
            ${tyreButton('MEDIUM', 'BALANCED', selectedCompound === 'MEDIUM')}
            ${tyreButton('HARD', 'SLOWER / LONG', selectedCompound === 'HARD')}
          </div>
        </div>
        <div class="setup-section">
          <div class="setup-title"><b>04 · RACE LENGTH</b><span>Target elapsed time; lap count adapts to the selected circuit.</span></div>
          <div class="lap-choice-row">
            ${RACE_LENGTH_OPTIONS.map((option) => `<button class="lap-choice ${option.id === selectedRaceLength ? 'selected' : ''}" data-race-length="${option.id}"><strong>${option.label}</strong><span>${option.targetMinutes} MIN</span></button>`).join('')}
          </div>
        </div>
      </section>

      <footer class="pre-race-footer">
        <div><b>SESSION</b><span>TIME TRIAL RETURNS HERE · GRAND PRIX STARTS SEPARATELY</span></div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
          <button class="start-race-button" data-time-trial>TIME TRIAL · UPDATE LINE</button>
          <button class="start-race-button" data-skip-qualifying>SKIP QUALIFYING · P8</button>
          <button class="start-race-button" data-start-race>START WEEKEND</button>
        </div>
      </footer>
    </div>
  </div>`;

  return new Promise((resolve) => {
    const refreshSelected = (): void => {
      root.querySelectorAll<HTMLElement>('[data-track]').forEach((node) => node.classList.toggle('selected', node.dataset.track === selectedTrack));
      root.querySelectorAll<HTMLElement>('[data-compound]').forEach((node) => node.classList.toggle('selected', node.dataset.compound === selectedCompound));
      root.querySelectorAll<HTMLElement>('[data-race-length]').forEach((node) => node.classList.toggle('selected', node.dataset.raceLength === selectedRaceLength));
      root.querySelectorAll<HTMLElement>('[data-cpu-line]').forEach((node) => {
        node.classList.toggle('selected', node.dataset.cpuLine === selectedCpuLine);
      });

      const playerCandidate = loadPlayerRacingLineCandidate(
        window.localStorage,
        selectedTrack,
      );
      const status = root.querySelector<HTMLElement>('[data-player-line-status]');
      if (status) {
        status.textContent = playerCandidate?.lapSeconds !== undefined
          ? `Clean player lap · ${playerCandidate.lapSeconds.toFixed(3)} s`
          : 'Uses the next clean qualifying/race lap';
      }
    };

    root.querySelectorAll<HTMLButtonElement>('[data-track]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedTrack = button.dataset.track as TrackId;
        selectedCpuLine = selectedRacingLineSource(
          window.localStorage,
          selectedTrack,
        );
        selectedLaps = raceLapsForPreset(selectedTrack, selectedRaceLength);
        refreshSelected();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-cpu-line]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.disabled) return;
        selectedCpuLine = button.dataset.cpuLine as SelectableRacingLineSource;
        saveSelectedRacingLineSource(
          window.localStorage,
          selectedTrack,
          selectedCpuLine,
        );
        refreshSelected();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-compound]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedCompound = button.dataset.compound as Compound;
        refreshSelected();
      });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-race-length]').forEach((button) => {
      button.addEventListener('click', () => {
        selectedRaceLength = button.dataset.raceLength as RaceLengthPreset;
        selectedLaps = raceLapsForPreset(selectedTrack, selectedRaceLength);
        refreshSelected();
      });
    });
    refreshSelected();

    const finishSetup = (
      skipQualifying: boolean,
      timeTrial = false,
    ): void => {
      root.innerHTML = '';
      resolve({
        trackId: selectedTrack,
        startCompound: selectedCompound,
        totalLaps: selectedLaps,
        raceLength: selectedRaceLength,
        skipQualifying,
        timeTrial,
      });
    };

    root.querySelector<HTMLButtonElement>('[data-start-race]')?.addEventListener(
      'click',
      () => finishSetup(false, false),
      { once: true },
    );
    root.querySelector<HTMLButtonElement>('[data-skip-qualifying]')?.addEventListener(
      'click',
      () => finishSetup(true, false),
      { once: true },
    );
    root.querySelector<HTMLButtonElement>('[data-time-trial]')?.addEventListener(
      'click',
      () => finishSetup(false, true),
      { once: true },
    );
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
