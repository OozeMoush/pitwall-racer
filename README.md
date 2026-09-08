# Pitwall Racer

A 3D top-down formula racing game where **driving, tyre life and electrical energy are one connected race decision**.

Pitwall Racer is a racing game first. It borrows Formula-style ideas only when they create good decisions. The dry-race two-compound tyre requirement is deliberately retained because it forces a meaningful strategy choice; extra realism is deferred unless it improves the race.

## Current playable direction

The presentation is built around a classic fixed-orientation top-down/isometric camera rather than a chase camera.

- Three.js full-screen WebGL 3D renderer
- fixed-direction elevated orthographic camera in the GeneRally-style family
- Rapier 2D rigid-body/contact solver under the planar race simulation
- all eight cars are dynamic rigid bodies with real velocity/angular velocity and CCD
- player and AI use the same arcade car controller for acceleration, braking, lateral slip and speed-dependent steering
- AI racecraft plans throttle, brake, overtaking lane, following gap and recovery against actual physical traffic positions
- procedural 3D formula cars with four tyres, wings, cockpit/halo and compound sidewall colour
- dry compound colours: Soft red / Medium yellow / Hard white
- 3D road, runoff, grass, kerbs, grid, pit buildings and grandstands
- dense track-edge visual references to make top-down speed legible
- enlarged mixed-character fictional circuit with a long straight and real braking sections
- 8-lap, 8-car race
- fixed 120 Hz physics/simulation step
- progressive acceleration rather than an instant speed-cap jump
- high-speed steering authority falls sharply, so braking creates the cornering opportunity
- Soft / Medium / Hard tyre model
- pre-race starting-compound choice
- tyre temperature, wear, grip and late-life cliff
- player tyre wear is driven mainly by actual steering, braking, speed and traffic load
- dry-race two-compound requirement with late-race obligation warnings
- physical pit-lane transit + tyre service
- AI CLEAR / FOLLOW / ATTACK / DEFEND / SIDE_BY_SIDE states
- adaptive AI undercut / overcut decisions
- dirty air vs tow interaction
- explicit HARVEST / NORMAL / DEPLOY hybrid modes
- HARVEST charges even while throttle is held but gives up substantial pace
- NORMAL is sustainable for keyboard driving
- DEPLOY spends charge quickly for an obvious attack-speed advantage
- current / last / best lap timing and delta feedback
- progressive TRACK / RUNOFF / GRASS behaviour so cutting the infield is naturally slower
- deterministic tyre-strategy tests plus a 30-second physical-pack playtest that emits speed, spacing, jerk, off-track and rendered-speed metrics in CI

The energy system is deliberately game-facing rather than a reproduction of every FIA electrical limit. The important rule is preserved: **speed bought with electrical energy has to be paid for somewhere else in the lap.**

## Run

```bash
npm install
npm run dev
```

### Controls — left hand only

Before the lights and for the next pit stop:

- `Q` — Soft
- `E` — Medium
- `R` — Hard

During the race:

- `WASD` — drive
- `1` — HARVEST
- `2` — NORMAL
- `3` — DEPLOY
- `F` — box this lap / cancel pit request
- `C` — recover only when stranded far off track

After the finish:

- `C` — race again

## Verify

```bash
npm test
npm run build
```

CI runs the same test/build verification on pull requests. Automated tests are guardrails, not a substitute for human play feel. The physical-pack playtest deliberately logs measurable proxies for the problems that are otherwise easy to miss in code review: apparent speed, AI pace, contact spikes and pack spacing. See [PLAYTEST.md](./PLAYTEST.md).

## Architecture

`src/simulation/` owns authoritative race truth independently from rendering.

`src/simulation/RapierRacePhysics.ts` owns the live planar rigid-body world. `ArcadeCarController.ts` supplies game-facing longitudinal/lateral tyre and power intent without manually integrating position or collision. `DynamicAiController.ts` supplies physical AI steering/throttle/brake intent from the real spline and live traffic. `src/game/ThreeRaceGame.ts` integrates input, strategy and the fixed-step race flow, while `src/rendering3d/` converts simulation state into the Three.js/WebGL world.

The physical-pack telemetry is intentionally part of CI now. A change that brings back rail-like AI, extreme speed spikes or weak rendered travel can be rejected before it reaches `main` even when ordinary unit tests still pass.

## Design rule

If leaving DEPLOY on forever, leaving HARVEST on forever, blindly pitting on one prescribed lap, cutting the infield, or ignoring tyre choice is optimal, the game is broken. If adding realism does not make the race more fun, defer it. See [DESIGN.md](./DESIGN.md).
