import { afterEach, expect, it, vi } from 'vitest';
import { showPreRaceMenu } from './PreRaceMenu';
import { DEFAULT_RACE_SETUP } from '../game/RaceSetup';

class Node {
  checked = false;
  disabled = false;
  textContent = '';
  classList = { toggle: () => {} };
  listeners = new Map<string, (event: { target: Node }) => void>();
  constructor(public dataset: Record<string, string> = {}) {}
  addEventListener(type: string, callback: (event: { target: Node }) => void) { this.listeners.set(type, callback); }
  fire(type = 'click') { this.listeners.get(type)?.({ target: this }); }
}
function menu() {
  const values = new Map<string, string>();
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  const trial = new Node(), status = new Node(), skip = new Node(), tt = new Node();
  const tracks = [new Node({ track: 'pitwall-gp' }), new Node({ track: 'velocity-park' })];
  const lines = [new Node({ cpuLine: 'AUTO' }), new Node({ cpuLine: 'PLAYER' })];
  const nodes: Record<string, Node> = { '[data-passing-trial]': trial, '[data-passing-status]': status,
    '[data-skip-qualifying]': skip, '[data-time-trial]': tt };
  const root = { innerHTML: '', querySelector: (selector: string) => nodes[selector] ?? null,
    querySelectorAll: (selector: string) => selector === '[data-track]' ? tracks : selector === '[data-cpu-line]' ? lines : [] };
  const result = showPreRaceMenu(root as unknown as HTMLElement, { ...DEFAULT_RACE_SETUP, trackId: 'pitwall-gp' });
  return { result, trial, status, skip, tt, tracks, lines };
}
afterEach(() => vi.unstubAllGlobals());
it('starts a normal P8 GP with passing and permits the old control comparison', async () => {
  const on = menu(); expect(on.trial.checked).toBe(true); on.skip.fire();
  expect(await on.result).toMatchObject({ experimentalPassing: true, skipQualifying: true, timeTrial: false });
  const off = menu(); off.trial.checked = false; off.trial.fire('change'); off.skip.fire();
  expect((await off.result).experimentalPassing).toBe(false);
});
it('disables the trial outside Pitwall AUTO and restores the selection on return', async () => {
  const view = menu(); view.tracks[1].fire(); expect(view.trial.disabled).toBe(true);
  view.tracks[0].fire(); expect(view.trial.checked).toBe(true);
  view.lines[1].fire(); expect(view.trial.disabled).toBe(true); view.skip.fire();
  expect((await view.result).experimentalPassing).toBe(false);
});
it('never enables the GP passing policy for a Time Trial', async () => {
  const view = menu(); view.tt.fire();
  expect(await view.result).toMatchObject({ timeTrial: true, experimentalPassing: false });
});
