# Pitwall Racer

A 3D top-down formula racing game where **driving pace and tyre management are the same decision**.

Pitwall Racer is a racing game first. It borrows Formula-style ideas only when they create good decisions. The dry-race two-compound tyre requirement is deliberately retained because it forces a meaningful strategy choice; extra realism is deferred unless it improves the race.

## Current rebuild

The project is being rebuilt around a real 3D race presentation rather than the original flat prototype.

- Three.js full-screen 3D renderer
- perspective chase camera from above and behind the car
- procedural 3D formula cars with four tyres, wings, cockpit/halo and compound sidewall colour
- 3D road, runoff, grass, kerbs, grid, pit buildings and grandstands
- mixed-character fictional circuit instead of the original oval test track
- long straight, heavy-braking section, fast upper section and technical sequence
- 8-lap, 8-car race
- fixed 120 Hz player simulation
- Soft / Medium / Hard tyre model
- pre-race starting-compound choice
- tyre temperature, wear, grip and late-life cliff
- worn tyres reduce turn-in confidence and braking performance
- Conserve / Balanced / Push pace modes
- dry-race two-compound requirement with late-race obligation warnings
- pit request + next-compound selection
- AI CLEAR / FOLLOW / ATTACK traffic states
- adaptive AI undercut / overcut decisions
- player/AI soft contact and contact speed loss
- dirty air vs tow interaction
- finite hybrid energy, braking harvest and hold-to-use OVERTAKE deployment
- current / last / best lap timing and delta feedback
- progressive TRACK / RUNOFF / GRASS behaviour so cutting the infield is naturally slower
- safe `R` recovery only when badly off track and nearly stopped
- deterministic headless tyre-strategy balance tests

The next major work is **physical pit-lane flow and corner-aware AI driving**. Those are being rebuilt as racing-game systems rather than adding more Formula-rule complexity.

The energy system is deliberately game-facing rather than a reproduction of every FIA electrical limit. The important rule is preserved: **energy used now must have been stored or harvested earlier.**

## Run

```bash
npm install
npm run dev
```

### Controls

Before the lights:

- `4` — start on Soft
- `5` — start on Medium
- `6` — start on Hard

During the race:

- `WASD` — drive
- `1` — Conserve
- `2` — Balanced
- `3` — Push
- `4` — select Soft for the next stop
- `5` — select Medium for the next stop
- `6` — select Hard for the next stop
- `Space` — hold OVERTAKE deployment
- `P` — box this lap / cancel pit request
- `R` — recover only when stranded far off track

After the finish:

- `R` — race again

## Verify

```bash
npm test
npm run build
```

CI runs the same test/build verification on pull requests. Automated tests are guardrails, not a substitute for human play feel. See [PLAYTEST.md](./PLAYTEST.md).

## Architecture

`src/simulation/` owns authoritative race truth independently from rendering.

`src/game/ThreeRaceGame.ts` integrates input, the fixed-step simulation and the playable race flow. `src/rendering3d/` converts simulation state into the Three.js world. Rendering is not the source of tyre, lap, order or strategy truth.

The current AI still uses a cheaper progress/lane model than the player's vehicle. Replacing the most visible limitations of that model is a current racing-feel priority.

## Design rule

If holding PUSH or OVERTAKE forever, blindly pitting on one prescribed lap, cutting the infield, or ignoring tyre choice is optimal, the game is broken. If adding realism does not make the race more fun, defer it. See [DESIGN.md](./DESIGN.md).
