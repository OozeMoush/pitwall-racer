# Pitwall Racer

A 3D top-down formula racing game where **driving, tyre life and electrical energy are one connected race decision**.

Pitwall Racer is a racing game first. It borrows Formula-style ideas only when they create good decisions. The dry-race two-compound tyre requirement is deliberately retained because it forces a meaningful strategy choice; extra realism is deferred unless it improves the race.

## Current playable direction

The presentation is built around a classic fixed-orientation top-down/isometric camera rather than a chase camera.

- Three.js full-screen 3D renderer
- fixed-direction elevated orthographic camera in the GeneRally-style family
- procedural 3D formula cars with four tyres, wings, cockpit/halo and compound sidewall colour
- dry compound colours: Soft red / Medium yellow / Hard white
- 3D road, runoff, grass, kerbs, grid, pit buildings and grandstands
- enlarged mixed-character fictional circuit with a long straight and real braking sections
- 8-lap, 8-car race
- fixed 120 Hz player simulation
- Soft / Medium / Hard tyre model
- pre-race starting-compound choice
- tyre temperature, wear, grip and late-life cliff
- player tyre wear is driven mainly by actual steering, braking, speed and traffic load
- dry-race two-compound requirement with late-race obligation warnings
- physical pit-lane transit + tyre service
- AI CLEAR / FOLLOW / ATTACK / DEFEND / SIDE_BY_SIDE states
- adaptive AI undercut / overcut decisions
- multi-lane AI occupancy so dense fields spread instead of rendering as one overlapping train
- player/AI soft contact with closing-speed control rather than hard positional bouncing
- dirty air vs tow interaction
- explicit HARVEST / NORMAL / DEPLOY hybrid modes
- HARVEST charges even while throttle is held but gives up substantial pace
- NORMAL is sustainable for keyboard driving
- DEPLOY spends charge quickly for an obvious attack-speed advantage
- current / last / best lap timing and delta feedback
- progressive TRACK / RUNOFF / GRASS behaviour so cutting the infield is naturally slower
- deterministic headless tyre-strategy balance tests

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

CI runs the same test/build verification on pull requests. Automated tests are guardrails, not a substitute for human play feel. See [PLAYTEST.md](./PLAYTEST.md).

## Architecture

`src/simulation/` owns authoritative race truth independently from rendering.

`src/game/ThreeRaceGame.ts` integrates input, the fixed-step simulation and the playable race flow. `src/rendering3d/` converts simulation state into the Three.js world. Rendering is not the source of tyre, lap, order or strategy truth.

The current AI still uses a cheaper progress/lane model than the player's vehicle. It is intentionally being improved as a racing opponent before more Formula-rule complexity is added.

## Design rule

If leaving DEPLOY on forever, leaving HARVEST on forever, blindly pitting on one prescribed lap, cutting the infield, or ignoring tyre choice is optimal, the game is broken. If adding realism does not make the race more fun, defer it. See [DESIGN.md](./DESIGN.md).
