import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');
const battleTimingCss = readFileSync(new URL('./battle-timing.css', import.meta.url), 'utf8');

describe('desktop HUD readability', () => {
  it('keeps timing, lap history and position tower at readable desktop sizes', () => {
    expect(css).toContain('.timing-strip{display:flex;gap:20px;padding:14px 18px;font-size:15px');
    expect(css).toContain('.lap-row{font-size:14px');
    expect(css).toContain('.tower span{display:grid;grid-template-columns:31px 27px 1fr;align-items:center;padding:9px 11px;color:#cbd4d0;font-size:15px');
  });

  it('keeps live tyre wear legible in the standings tower', () => {
    expect(battleTimingCss).toContain('grid-template-columns:27px 60px minmax(70px,1fr) 68px 72px 58px 72px');
    expect(battleTimingCss).toContain('grid-template-columns:23px 48px minmax(60px,1fr) 58px 50px 62px');
    expect(battleTimingCss).toContain('small:not(.tower-best):not(.tower-pace)');
    expect(battleTimingCss).toContain('.tower-wear-value.healthy{color:#45dc82}');
    expect(battleTimingCss).toContain('.tower-wear-meter{display:block;width:100%;height:4px');
  });

  it('uses F1-style purple and green timing states', () => {
    expect(css).toContain('.timing-purple{color:#d95cff!important');
    expect(css).toContain('.timing-green{color:#45dc82!important');
  });
});
