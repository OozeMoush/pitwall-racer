# Pitwall Racer

A modern top-down formula racing game where **driving pace and tyre management are the same decision**.

Pitwall Racer is a racing game first. It borrows Formula-style ideas only when they create good decisions. The dry-race two-compound tyre requirement is deliberately retained because it forces a meaningful strategy choice; extra realism is deferred unless it improves the race.

## Current playable race

- 8-lap, 8-car race
- authoritative 3-2-1-GO start and finish/result flow
- Phaser 4 / WebGL top-down renderer
- fixed 120 Hz player simulation
- smooth closed Catmull–Rom circuit shared by rendering, AI and track projection
- Soft / Medium / Hard tyre model
- pre-race starting-compound choice
- tyre temperature, wear, grip and late-life cliff
- worn tyres reduce turn-in confidence and braking performance
- Conserve / Balanced / Push pace modes
- dry-race two-compound requirement with late-race obligation warnings
- pit request + next-compound selection
- 8-car lightweight AI field
- AI CLEAR / FOLLOW / ATTACK traffic states and overtaking lanes
- adaptive AI undercut / overcut decisions
- player/AI soft contact, space ownership and contact speed loss
- dirty air vs tow interaction
- finite hybrid energy, braking harvest and hold-to-use OVERTAKE deployment
- current / last / best lap timing and delta feedback
- speed-sensitive camera, skid marks, tyre smoke and contact/off-track shake
- progressive TRACK / RUNOFF / GRASS behaviour so infield shortcuts are naturally slower
- safe `R` recovery only when badly off track and nearly stopped
- deterministic headless tyre-strategy balance tests
- immediate `R` restart after the finish

The current pit stop is intentionally abstract: boxing applies time loss and rejoins the racing line. A physical pit lane is presentation work, not required for the core strategy loop to function.

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

CI runs the same test/build verification on pull requests. The tests include race rules, tyre/vehicle behaviour, AI strategy, race flow, off-track behaviour, safe recovery and a headless balance harness designed to catch obvious dominant tyre strategies.

Automated tests are guardrails, not a substitute for human play feel. See [PLAYTEST.md](./PLAYTEST.md) for the short manual checklist that should drive future tuning.

## Architecture

`src/simulation/` owns race truth and is independent from rendering. The player uses the detailed vehicle model, while AI cars use a cheaper racing-line race model. This asymmetry is deliberate: the player needs tactile handling; the field needs believable behaviour at low cost.

`src/rendering/` consumes authoritative state for track presentation, camera/tyre effects and other spectacle. Phaser collects input and renders state; it is not the source of tyre, lap, race-order or strategy truth.

## Design rule

If holding PUSH or OVERTAKE forever, blindly pitting on one prescribed lap, cutting the infield, or ignoring tyre choice is optimal, the game is broken. See [DESIGN.md](./DESIGN.md).
