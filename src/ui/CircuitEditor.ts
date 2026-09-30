import {
  createDefaultCircuitAsset,
  exportCircuitAsset,
  importCircuitAsset,
  installCircuitAsset,
  loadCircuitAsset,
  saveCircuitAsset,
  validateCircuitAsset,
  type CircuitAsset,
  type CircuitControlPoint,
} from '../simulation/CircuitAsset';
import { saveSelectedRacingLineSource } from '../simulation/RacingLineSelectionStore';
import { EDITOR_TRACK_ID } from '../simulation/TrackModel';

type EditorResult = 'saved' | 'cancelled';
type EditorMode = 'GEOMETRY' | 'REFERENCE';

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 650;

export function showCircuitEditor(
  root: HTMLElement,
  storage: Storage,
): Promise<EditorResult> {
  let asset = cloneAsset(loadCircuitAsset(storage) ?? createDefaultCircuitAsset());
  let selectedIndex = Math.min(asset.controls.length - 1, asset.startControlIndex);
  let mode: EditorMode = 'GEOMETRY';
  let drag:
    | { kind: 'control'; index: number; pointerId: number }
    | { kind: 'reference'; index: number; pointerId: number }
    | undefined;

  root.innerHTML = `
    <div class="circuit-editor-shell">
      <div class="circuit-editor-topbar">
        <div>
          <small>PITWALL RACER / CIRCUIT LAB</small>
          <h1>CIRCUIT EDITOR</h1>
        </div>
        <div class="circuit-editor-mode">
          <button data-editor-mode="GEOMETRY">GEOMETRY</button>
          <button data-editor-mode="REFERENCE">REFERENCE LINE</button>
        </div>
      </div>
      <div class="circuit-editor-layout">
        <section class="circuit-editor-canvas-panel">
          <div class="circuit-editor-canvas-head">
            <div data-editor-summary></div>
            <div class="circuit-editor-legend">
              <span><i class="start"></i>START</span>
              <span><i class="sector"></i>SECTOR</span>
              <span><i class="pit"></i>PIT</span>
              <span><i class="reference"></i>REFERENCE</span>
            </div>
          </div>
          <svg data-circuit-canvas viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}" aria-label="Circuit editor canvas"></svg>
          <p class="circuit-editor-hint" data-editor-hint></p>
        </section>
        <aside class="circuit-editor-inspector" data-editor-inspector></aside>
      </div>
      <footer class="circuit-editor-footer">
        <div data-editor-validation></div>
        <div class="circuit-editor-actions">
          <button class="editor-secondary" data-editor-action="cancel">BACK</button>
          <button class="editor-primary" data-editor-action="save">SAVE & USE CIRCUIT</button>
        </div>
      </footer>
    </div>
  `;

  const shell = root.querySelector<HTMLElement>('.circuit-editor-shell');
  const svg = root.querySelector<SVGSVGElement>('[data-circuit-canvas]');
  if (!shell || !svg) throw new Error('Circuit editor workspace is missing');

  return new Promise((resolve) => {
    const render = (): void => {
      renderMode();
      renderCanvas();
      renderInspector();
      renderValidation();
    };

    const renderMode = (): void => {
      root.querySelectorAll<HTMLButtonElement>('[data-editor-mode]').forEach((button) => {
        button.classList.toggle('selected', button.dataset.editorMode === mode);
      });
      const hint = root.querySelector<HTMLElement>('[data-editor-hint]');
      if (hint) {
        hint.textContent = mode === 'GEOMETRY'
          ? 'Drag control points. Click empty canvas to append a point. Width is edited in the inspector.'
          : 'Drag cyan reference handles left/right from each control point to author the CPU seed line.';
      }
    };

    const renderCanvas = (): void => {
      const frame = drawingFrame(asset.controls);
      const path = asset.controls
        .map((point, index) => {
          const p = toScreen(point, frame);
          return `${index === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
        })
        .join(' ') + (asset.controls.length > 2 ? ' Z' : '');
      const leftRoad = asset.controls.map((point, index) => {
        const normal = controlNormal(asset.controls, index);
        const width = point.roadHalfWidth ?? 17;
        return toScreen({
          x: point.x + normal.x * width,
          y: point.y + normal.y * width,
        }, frame);
      });
      const rightRoad = asset.controls.map((point, index) => {
        const normal = controlNormal(asset.controls, index);
        const width = point.roadHalfWidth ?? 17;
        return toScreen({
          x: point.x - normal.x * width,
          y: point.y - normal.y * width,
        }, frame);
      }).reverse();
      const roadPolygon = [...leftRoad, ...rightRoad]
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
        .join(' ') + ' Z';

      const referencePoints = asset.controls.map((point, index) => {
        const ref = referencePoint(asset, index);
        const screen = toScreen(ref, frame);
        return { ...screen, index };
      });
      const referencePath = referencePoints
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
        .join(' ') + (referencePoints.length > 2 ? ' Z' : '');

      const markers = [
        markerAtProgress(asset, asset.sectorBoundaries[0], frame, 'S1', 'sector'),
        markerAtProgress(asset, asset.sectorBoundaries[1], frame, 'S2', 'sector'),
        markerAtProgress(asset, asset.pitLane.entryProgress, frame, 'PIT IN', 'pit'),
        markerAtProgress(asset, asset.pitLane.exitProgress, frame, 'PIT OUT', 'pit'),
      ].join('');

      const start = toScreen(asset.controls[asset.startControlIndex] ?? asset.controls[0], frame);
      const controlHandles = asset.controls.map((point, index) => {
        const screen = toScreen(point, frame);
        const selected = index === selectedIndex ? ' selected' : '';
        return `<g class="editor-control${selected}" data-control-index="${index}">
          <circle cx="${screen.x}" cy="${screen.y}" r="${index === selectedIndex ? 10 : 8}" data-control-index="${index}"></circle>
          <text x="${screen.x + 12}" y="${screen.y - 12}">${index + 1}</text>
        </g>`;
      }).join('');

      const referenceHandles = mode === 'REFERENCE'
        ? referencePoints.map((point) => `
          <rect class="editor-reference-handle${point.index === selectedIndex ? ' selected' : ''}"
            x="${point.x - 6}" y="${point.y - 6}" width="12" height="12"
            data-reference-index="${point.index}"></rect>`).join('')
        : '';

      svg.innerHTML = `
        <rect class="editor-canvas-bg" x="0" y="0" width="${VIEW_WIDTH}" height="${VIEW_HEIGHT}"></rect>
        <path class="editor-road-surface" d="${roadPolygon}"></path>
        <path class="editor-track-centre" d="${path}"></path>
        <path class="editor-reference-path" d="${referencePath}"></path>
        ${markers}
        <g class="editor-start-marker">
          <circle cx="${start.x}" cy="${start.y}" r="15"></circle>
          <text x="${start.x + 19}" y="${start.y + 5}">START</text>
        </g>
        ${controlHandles}
        ${referenceHandles}
      `;

      const summary = root.querySelector<HTMLElement>('[data-editor-summary]');
      if (summary) {
        summary.innerHTML = `<b>${escapeHtml(asset.name)}</b><span>~${Math.round(approximateLength(asset.controls))} m · ${asset.controls.length} controls · ${asset.scalePreset}</span>`;
      }
    };

    const renderInspector = (): void => {
      const inspector = root.querySelector<HTMLElement>('[data-editor-inspector]');
      if (!inspector) return;
      const point = asset.controls[selectedIndex];
      const referenceOffset = asset.referenceLine.laneOffsets[selectedIndex] ?? 0;
      inspector.innerHTML = `
        <section>
          <h2>CIRCUIT</h2>
          <label>NAME<input data-editor-field="name" value="${escapeAttribute(asset.name)}"></label>
          <label>SUBTITLE<input data-editor-field="subtitle" value="${escapeAttribute(asset.subtitle)}"></label>
          <label>SCALE
            <select data-editor-field="scalePreset">
              ${(['COMPACT', 'STANDARD', 'LONG'] as const).map((value) => `<option value="${value}" ${value === asset.scalePreset ? 'selected' : ''}>${value}</option>`).join('')}
            </select>
          </label>
        </section>

        <section>
          <h2>CONTROL ${selectedIndex + 1}</h2>
          <div class="editor-field-row">
            <label>X<input type="number" step="1" data-point-field="x" value="${round(point?.x ?? 0)}"></label>
            <label>Y<input type="number" step="1" data-point-field="y" value="${round(point?.y ?? 0)}"></label>
          </div>
          <label>ROAD HALF-WIDTH · m
            <input type="range" min="8" max="36" step="0.5" data-point-field="roadHalfWidth" value="${point?.roadHalfWidth ?? 17}">
            <output>${(point?.roadHalfWidth ?? 17).toFixed(1)} m</output>
          </label>
          <label>REFERENCE OFFSET · m
            <input type="range" min="-15" max="15" step="0.25" data-reference-field value="${referenceOffset}">
            <output>${referenceOffset.toFixed(2)} m</output>
          </label>
          <div class="editor-inline-actions">
            <button data-editor-action="set-start">SET START</button>
            <button data-editor-action="delete-point" ${asset.controls.length <= 6 ? 'disabled' : ''}>DELETE POINT</button>
          </div>
        </section>

        <section>
          <h2>SECTORS / PIT</h2>
          <div class="editor-field-row">
            <label>S1 %<input type="number" min="5" max="90" step="1" data-progress-field="sector1" value="${Math.round(asset.sectorBoundaries[0] * 100)}"></label>
            <label>S2 %<input type="number" min="10" max="95" step="1" data-progress-field="sector2" value="${Math.round(asset.sectorBoundaries[1] * 100)}"></label>
          </div>
          <div class="editor-field-row">
            <label>PIT IN %<input type="number" min="0" max="99" step="1" data-progress-field="pitEntry" value="${Math.round(asset.pitLane.entryProgress * 100)}"></label>
            <label>PIT OUT %<input type="number" min="0" max="99" step="1" data-progress-field="pitExit" value="${Math.round(asset.pitLane.exitProgress * 100)}"></label>
          </div>
          <div class="editor-field-row">
            <label>PIT LENGTH m<input type="number" min="120" max="1600" step="10" data-pit-field="lengthMetres" value="${round(asset.pitLane.lengthMetres)}"></label>
            <label>PIT OFFSET m<input type="number" min="10" max="80" step="1" data-pit-field="laneOffset" value="${round(asset.pitLane.laneOffset)}"></label>
          </div>
        </section>

        <section>
          <h2>GRID</h2>
          <div class="editor-field-row">
            <label>FRONT GAP m<input type="number" min="5" max="40" step="1" data-grid-field="frontGapMetres" value="${round(asset.grid.frontGapMetres)}"></label>
            <label>ROW STEP m<input type="number" min="8" max="40" step="1" data-grid-field="longitudinalStepMetres" value="${round(asset.grid.longitudinalStepMetres)}"></label>
          </div>
          <label>LANE OFFSET m<input type="number" min="2" max="10" step="0.5" data-grid-field="laneOffset" value="${asset.grid.laneOffset}"></label>
        </section>

        <section>
          <h2>JSON</h2>
          <textarea data-editor-json spellcheck="false" placeholder="Exported circuit JSON appears here. Paste JSON here to import."></textarea>
          <div class="editor-inline-actions">
            <button data-editor-action="export">EXPORT</button>
            <button data-editor-action="import">IMPORT</button>
            <button data-editor-action="reset">NEW SAMPLE</button>
          </div>
        </section>
      `;
    };

    const renderValidation = (): void => {
      const validation = validateCircuitAsset(asset);
      const node = root.querySelector<HTMLElement>('[data-editor-validation]');
      if (!node) return;
      if (validation.valid && validation.warnings.length === 0) {
        node.innerHTML = '<b class="editor-valid">VALID CIRCUIT</b><span>Ready to save and run.</span>';
        return;
      }
      if (validation.valid) {
        node.innerHTML = `<b class="editor-warning">VALID WITH WARNINGS</b><span>${validation.warnings.map(escapeHtml).join(' · ')}</span>`;
        return;
      }
      node.innerHTML = `<b class="editor-invalid">INVALID</b><span>${validation.errors.map(escapeHtml).join(' · ')}</span>`;
    };

    shell.addEventListener('click', async (event) => {
      const target = event.target as HTMLElement;
      const modeButton = target.closest<HTMLButtonElement>('[data-editor-mode]');
      if (modeButton) {
        mode = modeButton.dataset.editorMode as EditorMode;
        render();
        return;
      }

      const action = target.closest<HTMLButtonElement>('[data-editor-action]')?.dataset.editorAction;
      if (!action) return;

      if (action === 'cancel') {
        resolve('cancelled');
        return;
      }
      if (action === 'set-start') {
        asset.startControlIndex = selectedIndex;
        render();
        return;
      }
      if (action === 'delete-point') {
        if (asset.controls.length <= 6) return;
        asset.controls.splice(selectedIndex, 1);
        asset.referenceLine.laneOffsets.splice(selectedIndex, 1);
        if (asset.startControlIndex === selectedIndex) asset.startControlIndex = 0;
        else if (asset.startControlIndex > selectedIndex) asset.startControlIndex -= 1;
        selectedIndex = Math.max(0, Math.min(selectedIndex, asset.controls.length - 1));
        render();
        return;
      }
      if (action === 'reset') {
        asset = createDefaultCircuitAsset();
        selectedIndex = 0;
        render();
        return;
      }
      if (action === 'export') {
        const json = exportCircuitAsset(asset);
        const textarea = root.querySelector<HTMLTextAreaElement>('[data-editor-json]');
        if (textarea) {
          textarea.value = json;
          textarea.focus();
          textarea.select();
        }
        try {
          await navigator.clipboard?.writeText(json);
        } catch {
          // The textarea remains selected as a clipboard fallback.
        }
        return;
      }
      if (action === 'import') {
        const textarea = root.querySelector<HTMLTextAreaElement>('[data-editor-json]');
        if (!textarea?.value.trim()) return;
        try {
          asset = importCircuitAsset(textarea.value);
          selectedIndex = Math.min(asset.startControlIndex, asset.controls.length - 1);
          render();
        } catch (error) {
          textarea.setCustomValidity(error instanceof Error ? error.message : 'Invalid circuit JSON');
          textarea.reportValidity();
          textarea.setCustomValidity('');
        }
        return;
      }
      if (action === 'save') {
        const validation = validateCircuitAsset(asset);
        if (!validation.valid) {
          renderValidation();
          return;
        }
        const saved = saveCircuitAsset(storage, asset);
        installCircuitAsset(saved, storage);
        saveSelectedRacingLineSource(storage, EDITOR_TRACK_ID, 'EDITOR');
        resolve('saved');
      }
    });

    shell.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (target.matches('[data-editor-json]')) return;

      const field = target.getAttribute('data-editor-field');
      if (field === 'name') asset.name = target.value;
      if (field === 'subtitle') asset.subtitle = target.value;
      if (field === 'scalePreset') asset.scalePreset = target.value as CircuitAsset['scalePreset'];

      const pointField = target.getAttribute('data-point-field');
      if (pointField && asset.controls[selectedIndex]) {
        const value = Number(target.value);
        if (pointField === 'x') asset.controls[selectedIndex].x = value;
        if (pointField === 'y') asset.controls[selectedIndex].y = value;
        if (pointField === 'roadHalfWidth') asset.controls[selectedIndex].roadHalfWidth = value;
      }

      if (target.hasAttribute('data-reference-field')) {
        asset.referenceLine.laneOffsets[selectedIndex] = Number(target.value);
      }

      const progressField = target.getAttribute('data-progress-field');
      if (progressField) {
        const value = clamp(Number(target.value) / 100, 0, 0.99);
        if (progressField === 'sector1') asset.sectorBoundaries[0] = value;
        if (progressField === 'sector2') asset.sectorBoundaries[1] = value;
        if (progressField === 'pitEntry') asset.pitLane.entryProgress = value;
        if (progressField === 'pitExit') asset.pitLane.exitProgress = value;
      }

      const pitField = target.getAttribute('data-pit-field');
      if (pitField === 'lengthMetres') asset.pitLane.lengthMetres = Number(target.value);
      if (pitField === 'laneOffset') asset.pitLane.laneOffset = Number(target.value);

      const gridField = target.getAttribute('data-grid-field');
      if (gridField === 'frontGapMetres') asset.grid.frontGapMetres = Number(target.value);
      if (gridField === 'longitudinalStepMetres') asset.grid.longitudinalStepMetres = Number(target.value);
      if (gridField === 'laneOffset') asset.grid.laneOffset = Number(target.value);

      if (target instanceof HTMLInputElement && target.type === 'range') {
        const output = target.parentElement?.querySelector<HTMLOutputElement>('output');
        if (output) {
          output.value = target.hasAttribute('data-reference-field')
            ? `${Number(target.value).toFixed(2)} m`
            : `${Number(target.value).toFixed(1)} m`;
        }
      }
      renderCanvas();
      renderValidation();
    });

    svg.addEventListener('pointerdown', (event) => {
      const target = event.target as SVGElement;
      const controlIndex = target.getAttribute('data-control-index');
      const referenceIndex = target.getAttribute('data-reference-index');
      if (controlIndex !== null) {
        selectedIndex = Number(controlIndex);
        drag = { kind: 'control', index: selectedIndex, pointerId: event.pointerId };
        svg.setPointerCapture(event.pointerId);
        render();
        return;
      }
      if (referenceIndex !== null) {
        selectedIndex = Number(referenceIndex);
        drag = { kind: 'reference', index: selectedIndex, pointerId: event.pointerId };
        svg.setPointerCapture(event.pointerId);
        render();
      }
    });

    svg.addEventListener('pointermove', (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const frame = drawingFrame(asset.controls);
      const screen = pointerToViewBox(svg, event);
      const world = fromScreen(screen, frame);

      if (drag.kind === 'control') {
        asset.controls[drag.index].x = world.x;
        asset.controls[drag.index].y = world.y;
      } else {
        const point = asset.controls[drag.index];
        const normal = controlNormal(asset.controls, drag.index);
        const dx = world.x - point.x;
        const dy = world.y - point.y;
        asset.referenceLine.laneOffsets[drag.index] = clamp(dx * normal.x + dy * normal.y, -15, 15);
      }
      renderCanvas();
      renderValidation();
    });

    const stopDrag = (event: PointerEvent): void => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag = undefined;
      render();
    };
    svg.addEventListener('pointerup', stopDrag);
    svg.addEventListener('pointercancel', stopDrag);

    svg.addEventListener('click', (event) => {
      if (mode !== 'GEOMETRY' || event.target !== svg.querySelector('.editor-canvas-bg')) return;
      const frame = drawingFrame(asset.controls);
      const point = fromScreen(pointerToViewBox(svg, event), frame);
      asset.controls.push({ ...point, roadHalfWidth: 17 });
      asset.referenceLine.laneOffsets.push(0);
      selectedIndex = asset.controls.length - 1;
      render();
    });

    render();
  });
}

interface DrawingFrame {
  minX: number;
  minY: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

function drawingFrame(points: readonly CircuitControlPoint[]): DrawingFrame {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 1);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 1);
  const pad = 90;
  const scale = Math.min(
    (VIEW_WIDTH - pad * 2) / Math.max(1, maxX - minX),
    (VIEW_HEIGHT - pad * 2) / Math.max(1, maxY - minY),
  );
  return {
    minX,
    minY,
    scale,
    offsetX: (VIEW_WIDTH - (maxX - minX) * scale) / 2,
    offsetY: (VIEW_HEIGHT - (maxY - minY) * scale) / 2,
  };
}

function toScreen(point: { x: number; y: number }, frame: DrawingFrame): { x: number; y: number } {
  return {
    x: frame.offsetX + (point.x - frame.minX) * frame.scale,
    y: frame.offsetY + (point.y - frame.minY) * frame.scale,
  };
}

function fromScreen(point: { x: number; y: number }, frame: DrawingFrame): { x: number; y: number } {
  return {
    x: frame.minX + (point.x - frame.offsetX) / Math.max(0.0001, frame.scale),
    y: frame.minY + (point.y - frame.offsetY) / Math.max(0.0001, frame.scale),
  };
}

function pointerToViewBox(svg: SVGSVGElement, event: PointerEvent | MouseEvent): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * VIEW_WIDTH / Math.max(1, rect.width),
    y: (event.clientY - rect.top) * VIEW_HEIGHT / Math.max(1, rect.height),
  };
}

function markerAtProgress(
  asset: CircuitAsset,
  progress: number,
  frame: DrawingFrame,
  label: string,
  kind: string,
): string {
  const world = sampleControlPolygon(orderedControls(asset), progress);
  const point = toScreen(world, frame);
  return `<g class="editor-marker ${kind}">
    <circle cx="${point.x}" cy="${point.y}" r="9"></circle>
    <text x="${point.x + 12}" y="${point.y + 4}">${label}</text>
  </g>`;
}

function orderedControls(asset: CircuitAsset): CircuitControlPoint[] {
  if (asset.controls.length === 0) return [];
  const start = ((asset.startControlIndex % asset.controls.length) + asset.controls.length)
    % asset.controls.length;
  return [...asset.controls.slice(start), ...asset.controls.slice(0, start)];
}

function sampleControlPolygon(
  controls: readonly CircuitControlPoint[],
  progress: number,
): { x: number; y: number } {
  if (controls.length === 0) return { x: 0, y: 0 };
  const lengths = controls.map((point, index) => {
    const next = controls[(index + 1) % controls.length];
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
  const total = lengths.reduce((sum, value) => sum + value, 0);
  let target = ((progress % 1) + 1) % 1 * total;
  for (let index = 0; index < controls.length; index++) {
    if (target <= lengths[index]) {
      const next = controls[(index + 1) % controls.length];
      const t = lengths[index] <= 0 ? 0 : target / lengths[index];
      return {
        x: controls[index].x + (next.x - controls[index].x) * t,
        y: controls[index].y + (next.y - controls[index].y) * t,
      };
    }
    target -= lengths[index];
  }
  return controls[0];
}

function referencePoint(asset: CircuitAsset, index: number): { x: number; y: number } {
  const point = asset.controls[index];
  const normal = controlNormal(asset.controls, index);
  const offset = asset.referenceLine.laneOffsets[index] ?? 0;
  return {
    x: point.x + normal.x * offset,
    y: point.y + normal.y * offset,
  };
}

function controlNormal(
  controls: readonly CircuitControlPoint[],
  index: number,
): { x: number; y: number } {
  const previous = controls[(index - 1 + controls.length) % controls.length];
  const next = controls[(index + 1) % controls.length];
  const dx = next.x - previous.x;
  const dy = next.y - previous.y;
  const length = Math.max(0.0001, Math.hypot(dx, dy));
  return { x: -dy / length, y: dx / length };
}

function approximateLength(points: readonly CircuitControlPoint[]): number {
  return points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length];
    return total + Math.hypot(next.x - point.x, next.y - point.y);
  }, 0);
}

function cloneAsset(asset: CircuitAsset): CircuitAsset {
  return JSON.parse(JSON.stringify(asset)) as CircuitAsset;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;');
}
