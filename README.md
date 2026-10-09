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
- quiet driver-relative stereo sound for the nearest two physical rivals, plus short position/pit-exit/best/finish cues; pause VOLUME / MUTE controls all sound
- five-light randomized race start with measured throttle reaction time
- current / last / best lap timing, S1/S2/S3, lap history and live circuit map
- fixed 120 Hz physics/simulation step
- AUTO and PLAYER BEST CPU racing-line sources
- standalone Time Trial for improving PLAYER BEST; **ドライバー記録** in session selection opens browser-local TT history, condition-scoped PB updates, clean rate and lap-time spread
- one-shot qualifying before the Grand Prix, with an option to skip and start P8

## Issue #153 normal-race trial (PR #177)

On `feat/153-defensive-racecraft`, open the normal game at
`http://localhost:5175/`. Choose **Pitwall GP / AUTO**, leave **CPU攻防を試す**
checked, and start a QUICK Grand Prix (SKIP QUALIFYING starts P8).
Uncheck it to compare the established CPU control. This review candidate runs
with the normal seven CPU cars, tyres, strategy and physical pit stops.
Other circuits and PLAYER/EDITOR lines are outside the trial; the separate
`passing-lab.html` remains available for focused diagnostics. Human acceptance
is still pending; see `docs/experiments/153-defensive-racecraft.md`.

## Race setup

The pre-race menu currently offers circuits with explicit physical scale profiles. Circuit scale is independent from race duration: Compact tracks can keep short, dense laps while Standard tracks can use race-scale spacing.

- Pitwall GP
- Velocity Park
- Switchback Ring
- Sakura Esses
- Harbor Chicane
- Serra Circuit
- Baku Street

Choose a starting tyre and a **QUICK / SHORT / STANDARD / LONG** race duration. Lap count is derived per circuit from its representative pace; QUICK targets roughly **8 minutes** (at least six laps; Baku roughly nine), followed by 18 / 27 / 36-minute targets. All formats require two different compounds with shared tyre wear; QUICK CPUs plan one physical stop. STANDARD targets roughly **27 minutes**. The six fictional circuits use Compact profiles: machine reference laps are roughly 20–34 seconds, with Pitwall GP around 34 seconds and Serra around 23 seconds. Baku retains its deliberately authored long straight and Standard profile. The fictional circuits no longer add kilometres of straight running to reach a 90-second target.

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

After a requested physical pit entry, AUTO PIT drives to the box, services the car and follows the lane to the exit. WASD resumes when the car rejoins; releasing the accelerator or holding the entry turn does not interrupt the stop. A pit request alone does not steer a car off the main road.

After the race, the review shows observed position/gap traces, a selected rival's
pit history and matching lap times. Unfinished CPUs remain identified at the
player finish cutoff. Review buttons retry the initial CPU line/grid with the
same or a different starting tyre; F still controls pit timing during the retry.
The JSON export preserves comparison settings and recorded evidence for later
analysis. Records stay in memory until you export or restart; persistent driving
progress is separate work. `C` retains its original quick-restart behavior.

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

CI runs the fast, playtest and long tiers for pull requests targeting `main`, repeats them after pushes to `main`, and can also be started manually. The production build runs in the fast tier. Automated tests are guardrails, not a substitute for human feel.

## Repository workflow

`main` is the always-green integration branch.

- Start normal code work from current `main` on a short-lived branch such as `feat/*`, `fix/*`, `chore/*`, `test/*` or `refactor/*`.
- Open a pull request back to `main` and use CI as the merge gate. This is useful even for solo development because the PR records the change and keeps broken commits out of `main`.
- Prefer **squash merge** so one completed change becomes one readable commit on `main`.
- Delete the head branch after merge. If a PR is abandoned or superseded, delete that branch too; revive the idea later from a fresh branch based on current `main`.
- Small Issues should normally stay one PR. Large Issues may be split across several coherent, independently mergeable PRs; the Issue closes only when its acceptance criteria are complete. Branch names are implementation details; the Issue and merged PRs are the durable history.
- Avoid direct pushes to `main` for normal development. Repository-administration emergencies are the only intended exception.
- Never rewrite published `main` history to make it look cleaner. Clean forward with small PRs instead.

The repository is public, but public visibility does not grant strangers push access. The intended repository settings for `main` are: require a pull request, require all CI tiers, require linear history, block force-pushes and branch deletion, and require **0 approving reviews** for this solo project. Keep an administrator bypass only for genuine recovery work.

Enable automatic deletion of merged head branches so the branch list stays short.

## Project operations

Pitwall Racer uses a repository-first operating model. GitHub — not chat history or model memory — is the durable project source of truth.

- [Current project state](./docs/PROJECT_STATE.md) — canonical session-recovery snapshot
- [Project operations](./docs/PROJECT_OPERATIONS.md) — information ownership, Issue/PR lifecycle, startup and handoff protocol
- [ChatGPT Project + Work setup](./docs/CHATGPT_PROJECT_SETUP.md) — recommended Project instructions and Work startup prompt
- [Design](./DESIGN.md) — durable product/design decisions
- [Playtest gate](./PLAYTEST.md) — gameplay verification rules

GitHub Issues are the authoritative work queue and resume points. A new ChatGPT/Work session should be able to recover the project from these repository documents plus the relevant Issue/PR without prior conversation context.

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

Mouse wheel over the driving canvas zooms in/out in race and qualifying (0.5×–2.5×). UI panels retain normal scrolling.

## Isolated CPU passing lab (#153)

On the experimental PR branch, run `npm run dev` and open
`http://localhost:5175/passing-lab.html` for a keyboard-controlled, two-car
physical trial. The current candidate recognizes early defence; choose old/new
and straight/error/overlap starts for comparison. Blue is you, yellow is the CPU; WASD drives, P pauses and R
resets. Normal race/TT remains line-locked. See
[experiment conditions and remaining gates](./docs/experiments/153-defensive-racecraft.md).
`npm run build` also validates the lab in a separate `dist-passing-lab/` output.
