# Pitwall Racer

A modern top-down formula racing game where **driving pace and tyre management are the same decision**.

The project starts with the dry-race core: pushing must cost tyre life, traffic must change tyre behaviour, pit timing must react to race context, and extra electrical power must come from finite stored energy.

## Current playable race

- Phaser 4 / WebGL top-down renderer
- purpose-built lightweight player vehicle dynamics
- fixed 120 Hz authoritative player simulation
- smooth closed Catmull–Rom racing spline
- track presentation generated from the same authoritative spline
- Soft / Medium / Hard tyre model
- tyre temperature, wear, grip and late-life cliff
- Conserve / Balanced / Push pace modes
- 8-car lightweight AI field
- AI CLEAR / FOLLOW / ATTACK traffic states and visible overtaking lanes
- dirty air vs tow interaction
- adaptive AI undercut / overcut decisions around planned stops
- pit request + next-compound selection
- dry-race two-compound requirement
- current / last / best lap timing and delta feedback
- finite hybrid energy state, braking harvest and hold-to-use OVERTAKE deployment
- speed-sensitive camera, skid marks, tyre smoke and off-track shake
- live position, tyre, energy and strategy HUD

The current pit stop is intentionally abstract: the stop applies time loss and rejoins the racing line. A physical pit-lane path comes after the core strategy loop is proven.

The energy system is deliberately game-facing rather than a claim to reproduce every FIA electrical limit. The important rule is preserved: **energy used now must have been stored or harvested earlier.**

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
- `Space` — hold OVERTAKE deployment
- `P` — box this lap / cancel pit request

## Verify

```bash
npm test
npm run build
```

CI runs the same test/build verification on pull requests.

## Architecture

`src/simulation/` owns race truth and is independent from rendering. The player uses the detailed vehicle model, while AI cars use a cheaper racing-line race model. This keeps a future 20-car field practical and makes headless strategy simulations possible.

`src/rendering/` consumes authoritative state for track presentation, camera/tyre effects and other spectacle. Phaser collects input and renders state; it is not the source of tyre, lap, race-order or strategy truth.

## Design rule

If holding PUSH or OVERTAKE forever, or blindly pitting on one prescribed lap, is optimal, the game is broken. See [DESIGN.md](./DESIGN.md).
