# Pitwall Racer

A 3D top-down formula racing game where **driving, tyre life and racecraft come first**.

Pitwall Racer borrows Formula-style ideas only when they make the race more fun. The dry-race two-compound tyre requirement stays because it forces a meaningful strategy choice. Energy management is intentionally parked until the plain racing game is strong enough to be fun without it.

## Current playable direction

The presentation uses a fixed-orientation elevated top-down camera in the GeneRally-style family rather than a chase camera.

- Three.js / WebGL 3D renderer
- Rapier 2D rigid-body/contact solver for the planar race
- all eight cars are dynamic rigid bodies with real velocity, angular velocity and CCD
- player and AI use the same arcade car controller for acceleration, braking, lateral slip and speed-dependent steering
- tyre advantage is expressed through braking, corner speed and line choice, not fake straight-line engine power
- Soft red / Medium yellow / Hard white
- physical pit-lane transit and tyre service for player and AI
- dry-race two-compound requirement
- AI CLEAR / FOLLOW / ATTACK / DEFEND / SIDE_BY_SIDE racecraft states
- dirty air and tow
- current / last / best lap timing, S1/S2/S3, lap history and live circuit map
- fixed 120 Hz physics/simulation step

### Core-race-first build

Before the race starts, the setup screen now lets you choose:

- **Circuit** — Pitwall GP, Velocity Park or Switchback Ring
- **Starting tyre** — Soft / Medium / Hard
- **Distance** — 10 / 12 / 16 laps; 12 laps is the default

The circuits deliberately have different characters: balanced, high-speed and technical. Track presentation now uses a common visual language for road edge lines, runoff, kerbs, barriers, pit buildings and trackside references.

The live energy controls are disabled in this phase. There is one fixed power baseline for everybody; the current balancing target is simple:

**brake well, carry speed, use the tyre, fight the AI, choose a pit window.**

Energy management will return only after that loop is satisfying on its own.

## Run

```bash
npm install
npm run dev
```

## Controls — left hand only

Before the race, use the setup screen to choose circuit, starting tyre and distance.

During the race:

- `WASD` — drive
- `Q` — select Soft for the next stop
- `E` — select Medium
- `R` — select Hard
- `F` — box this lap / cancel pit request
- `C` — recover when stranded far off track

After the finish:

- `C` — race the same setup again

## Verify

```bash
npm test
npm run build
```

CI runs the same verification on pull requests. Automated tests are guardrails, not a substitute for human play feel. The physical-pack test emits apparent speed, AI pace, spacing, jerk and off-track metrics; the tyre strategy test checks whether longer races still create a meaningful pit decision.

## Architecture

`src/simulation/` owns authoritative race truth independently from rendering.

- `RapierRacePhysics.ts` owns the live planar rigid-body world.
- `ArcadeCarController.ts` supplies longitudinal/lateral arcade-formula behaviour.
- `DynamicAiController.ts` supplies AI throttle, brake, steering and line intent from the real spline and physical traffic.
- `CoreRaceGame.ts` integrates the current energy-free race loop.
- `TrackModel.ts` owns the active selectable circuit used by projection, AI and rendering.
- `rendering3d/` converts simulation state into the Three.js world.

The older energy model remains in the repository as a deferred system and still has focused tests, but it is not part of the current playable core.

## Design rule

If a race is not fun before energy management is added, energy management is not the fix. Driving, AI pressure, tyre feel and pit timing must stand on their own first. See [DESIGN.md](./DESIGN.md).
