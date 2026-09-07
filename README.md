# Pitwall Racer

A modern top-down formula racing game where **driving pace and tyre management are the same decision**.

The project deliberately starts with the dry-race core: the car must feel alive, pushing must cost tyre life, traffic must change tyre behaviour, and pit timing must matter. Weather, safety cars and multiplayer come later.

## Current playable race

- Phaser 4 / WebGL top-down renderer
- purpose-built lightweight vehicle dynamics
- fixed 120 Hz simulation loop
- Soft / Medium / Hard tyre model
- tyre temperature, wear, grip and late-life cliff
- Conserve / Balanced / Push pace modes
- 8-car field with lightweight strategy AI
- lap validation with track checkpoints
- pit request + next-compound selection
- dry-race two-compound requirement
- tow vs dirty-air interaction behind traffic
- live position, tyre and strategy HUD

## Run

```bash
npm install
npm run dev
```

### Controls

- `WASD` — drive
- `1` — Conserve
- `2` — Balanced
- `3` — Push
- `4` — select Soft for next stop
- `5` — select Medium
- `6` — select Hard
- `P` — box this lap / cancel pit request

## Verify

```bash
npm test
npm run build
```

## Architecture

`src/simulation/` is authoritative and independent from rendering. The player uses the detailed vehicle model, while AI cars use a cheaper racing-line race model. This keeps a future 20-car field practical and makes headless strategy simulations possible.

Phaser only renders state and collects input; it is not the source of race truth.

## Design rule

If holding PUSH forever or blindly pitting on one prescribed lap is optimal, the game is broken. See [DESIGN.md](./DESIGN.md).
