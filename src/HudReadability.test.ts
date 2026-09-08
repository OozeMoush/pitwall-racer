import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
const game = readFileSync(new URL('./game/ThreeRaceGame.ts', import.meta.url), 'utf8');

describe('desktop HUD readability', () => {
  it('keeps timing, lap history and position tower at readable desktop sizes', () => {
    expect(css).toContain('.timing-strip{display:flex;gap:20px;padding:14px 18px;font-size:15px');
    expect(css).toContain('.lap-row{font-size:14px');
    expect(css).toContain('.tower span{display:grid;grid-template-columns:31px 27px 1fr;align-items:center;padding:9px 11px;color:#cbd4d0;font-size:15px');
  });

  it('uses F1-style purple and green timing states', () => {
    expect(css).toContain('.timing-purple{color:#d95cff!important');
    expect(css).toContain('.timing-green{color:#45dc82!important');
  });

  it('renders battery charge as a gauge instead of a visible percentage number', () => {
    expect(game).toContain('class="energy-meter');
    expect(game).not.toContain('<b>${energyPct}%</b>');
  });
});
