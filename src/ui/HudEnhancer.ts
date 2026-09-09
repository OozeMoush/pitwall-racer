import { gripPercent } from '../simulation/TireModel';

export function installHudEnhancer(hud: HTMLElement): () => void {
  let scheduled = false;

  const enhance = () => {
    scheduled = false;

    // Core-race tyre grip is an internal physics coefficient. Present it as a
    // relative percentage where nominal Medium = 100%, so the number reads as
    // tyre performance rather than an arbitrary coefficient.
    const tyreDetail = hud.querySelector<HTMLElement>('.core-race-data > div:first-child span');
    if (tyreDetail && tyreDetail.dataset.gripNormalized !== '1') {
      const match = tyreDetail.textContent?.match(/GRIP\s+(\d+)%/);
      if (match) {
        const rawGrip = Number(match[1]) / 100;
        const relative = Math.max(0, Math.round(gripPercent(rawGrip)));
        tyreDetail.textContent = tyreDetail.textContent?.replace(/GRIP\s+\d+%/, `GRIP ${relative}%`) ?? '';
        tyreDetail.dataset.gripNormalized = '1';
        tyreDetail.title = 'Grip relative to nominal Medium tyre = 100%';
      }
    }

    // Legacy energy HUD support remains for the older renderer path.
    const energyValue = hud.querySelector<HTMLElement>('.race-data > div:nth-child(3) b');
    if (!energyValue || energyValue.querySelector('.energy-meter')) return;

    const match = energyValue.textContent?.match(/(\d+)%/);
    if (!match) return;
    const pct = Math.max(0, Math.min(100, Number(match[1])));
    const modeNode = hud.querySelector<HTMLElement>('.race-data > div:first-child b');
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
