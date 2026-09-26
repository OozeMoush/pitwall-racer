# Pitwall Racer

A 3D top-down formula racing game where **driving, tyre life and racecraft come first**.

Pitwall Racer uses Formula-style ideas when they improve the race. The current playable core focuses on physical driving, tyre strategy, qualifying, pit stops and CPU racecraft; the older hybrid-energy system remains deferred.

## Current playable direction

The presentation uses a fixed-orientation elevated top-down camera in the GeneRally-style family rather than a chase camera.

- Three.js / WebGL 3D renderer
- Rapier 2D rigid-body/contact solver for the planar race
- eight physical cars: player plus seven dynamic CPU cars
- shared arcade car physics for acceleration, braking, lateral slip and speed-dependent steering
- Soft red / Medium yellow / Hard white tyre compounds
- physical pit-lane transit and tyre service for player and CPU
- dry-race two-compound requirement
- line-locked CPU driving with longitudinal FOLLOW traffic control
- driver-specific CPU pace, consistency and technical precision with smooth live form variation
- dirty air and tow
- five-light randomized race start with measured throttle reaction time
- current / last / best lap timing, S1/S2/S3, lap history and live circuit map
- fixed 120 Hz physics/simulation step
- AUTO and PLAYER BEST CPU racing-line sources
- standalone Time Trial for improving PLAYER BEST
- one-shot qualifying before the Grand Prix, with an option to skip and start P8

## Race setup

The pre-race menu currently offers seven miniature circuits:

- Pitwall GP
- Velocity Park
- Switchback Ring
- Sakura Esses
- Harbor Chicane
- Serra Circuit
- Baku Street

Choose a starting tyre and a race distance of **40 / 50 / 60 laps**. The default is **50 laps**.

The circuits deliberately have different characters: balanced, high-speed, technical, rhythm, street-style and short-lap layouts. Track presentation uses a common visual language for road edges, runoff, kerbs, barriers, pit buildings and trackside references.

The live energy controls are disabled in the current core-race build. The balancing target is simple:

**brake well, carry speed, use the tyre, fight the CPU, choose a pit window.**

## Run

```bash
npm install
npm run dev
```

## Controls

During qualifying, Time Trial and the race:

- `WASD` — drive
- `C` — recover when stranded
- `P` or `Escape` — pause the Grand Prix

During the race:

- `Q` — select Soft for the next stop
- `E` — select Medium
- `R` — select Hard
- `F` — box this lap / cancel pit request

After the race, `C` starts the same setup again.

## Verify

The test suite is split by feedback speed without changing the full-suite gate:

```bash
npm run test:fast      # cheap unit/regression loop
npm run test:playtest  # focused gameplay/physics regressions
npm run test:long      # multi-lap, multi-circuit and endurance checks
npm test               # full suite; authoritative final gate
npm run build
```

Use `test:fast` while iterating. Gameplay changes should also run `test:playtest`. Run `test:long` directly when touching racing-line replay, long-run CPU behaviour, multi-circuit physics or the machine reference. Before merging a gameplay change, `npm test` and `npm run build` remain mandatory.

CI runs the full test suite and production build on pushes to `main` and can also be started manually. Automated tests are guardrails, not a substitute for human feel.

## Architecture

`src/simulation/` owns authoritative race truth independently from rendering.

- `RapierRacePhysics.ts` owns the live planar rigid-body world.
- `ArcadeCarController.ts` supplies longitudinal/lateral arcade-formula behaviour.
- `DynamicAiController.ts` supplies CPU throttle, brake and reference-line steering; traffic may reduce longitudinal pace but never invents a lateral passing line.
- `RacingLineRuntime.ts` and related racing-line modules execute AUTO / PLAYER BEST reference data.
- `CoreRaceGame.ts` integrates the current Grand Prix loop.
- `QualifyingGame.ts` runs qualifying and standalone Time Trial sessions.
- `TrackModel.ts` owns the active selectable circuit used by projection, CPU logic and rendering.
- `rendering3d/` converts simulation state into the Three.js world.

The older energy model remains in the repository as a deferred system and still has focused tests, but it is not part of the current playable core.

## Design rule

If a race is not fun before another major system is added, that system is not the fix. Driving, CPU pressure, tyre feel and pit timing must stand on their own first. See [DESIGN.md](./DESIGN.md).
