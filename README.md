# Pitwall Racer

A modern top-down formula racing game where **driving pace and tyre management are the same decision**.

The project deliberately starts with the dry-race core: the car must feel alive, pushing must cost tyre life, and conserving must create a real strategic option. Weather, safety cars and multiplayer come later.

## Current playable laboratory

- Phaser/WebGL top-down renderer
- purpose-built lightweight vehicle dynamics
- fixed 120 Hz simulation loop
- Soft / Medium / Hard tyre model
- tyre temperature, wear, grip and late-life cliff
- Conserve / Balanced / Push pace modes
- modern HTML/CSS telemetry overlay

## Run

```bash
npm install
npm run dev
```

Controls: `WASD` to drive, `1` Conserve, `2` Balanced, `3` Push.

## Verify

```bash
npm test
npm run build
```

## Design rule

If holding PUSH forever is optimal, the game is broken. See [DESIGN.md](./DESIGN.md) for the product thesis and milestones.
