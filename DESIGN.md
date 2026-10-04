# Pitwall Racer — Design

## Product thesis

Pitwall Racer is a **top-down racing game first**. It borrows the parts of Formula racing that create interesting decisions, but realism is never the goal by itself.

The current core question is deliberately simpler than before:

**Can braking, cornering, tyre choice, AI battles and pit timing make a fun race without any extra resource system?**

If the answer is no, adding more systems is not allowed to hide that weakness.

The primary strategic decision remains: **how much future tyre life are you willing to spend for lap time now?** That tyre cost should come mainly from what the player actually does — speed, steering load, braking and fighting another car — rather than from a separate magical pace switch.

## Energy-management status

HARVEST / NORMAL / DEPLOY are **temporarily removed from the playable race loop**.

The energy model remains in the codebase and can return later, but only after the core race is demonstrably fun. When it returns, it must add a new layer of decision-making rather than repair weak driving or weak AI.

This is an intentional product decision, not a technical regression.

## Non-negotiable race rule

The dry-race **two-compound tyre requirement stays**. It is not present for realism alone: it forces at least one meaningful strategy decision and prevents a single-compound dominant solution.

## Product priority

When choosing work, use this order:

1. Driving must feel fast and satisfying within seconds.
2. AI must be quick enough to create pressure without hidden rubber-banding.
3. CPU traffic must stay stable and readable without sacrificing the reference racing line.
4. Tyre condition must be felt through braking and cornering, not only read from telemetry.
5. Pit timing and compound choice must change the result of the race.
6. Circuit variety and presentation must make repeated races worth playing.
7. Only then reintroduce energy management and other Formula-like systems.

Every proposed feature must pass one question: **does this make the race more fun, or merely more complicated?**

## Current race format

The setup screen supports three session paths:

- standalone **Time Trial** for empty-track hotlapping and PLAYER BEST updates;
- **Race Weekend** with one-shot qualifying followed by the Grand Prix;
- **Skip Qualifying** for a direct P8 Grand Prix start.

Grand Prix setup includes:

- selectable circuits with explicit physical scale profiles (Compact / Standard / Long);
- Soft / Medium / Hard starting tyre;
- SHORT / STANDARD / LONG duration presets targeting roughly 18 / 27 / 36 minutes, with lap count derived per circuit;
- AUTO or PLAYER BEST CPU racing-line source.

The current circuit set is Pitwall GP, Velocity Park, Switchback Ring, Sakura Esses, Harbor Chicane, Serra Circuit and Baku Street.


## Physical circuit scale

Physical circuit scale is **not** a race-duration setting.

Pitwall Racer deliberately supports multiple physical formats:

- **Compact** — purpose-built short laps, typically around 20–40 seconds. Serra Circuit is the reference Compact benchmark.
- **Standard** — the current race-scale format, typically around 75–105 seconds. Baku Street retains the Standard format.
- **Long** — available to the circuit editor for layouts that deliberately need more physical space. It is not a requirement for ordinary circuits.

SHORT / STANDARD / LONG race-duration presets remain a separate axis. The same ~27-minute STANDARD event is about 70 laps at Serra, 48 laps at compact Pitwall GP and 18 laps at Standard Baku. Event duration must not be implemented by stretching the track.

The strategy model normalizes fixed per-lap tyre/slide effects by both representative lap duration and pit cost. This prevents a compact circuit from becoming a forced two-stop race merely because the same 27 minutes contains many more lap boundaries.

### Compact driving rhythm — Issue #137, first implementation slice

Human playtesting rejected the fictional layouts' long straight extensions.
Pitwall GP, Velocity Park, Switchback Ring, Sakura Esses and Harbor Chicane now
remove their 2.8–3.2 km outward extensions; the existing corner sequences remain.
Pitwall's original compact footprint needs a 1.4 spacing factor to keep its
technical section physically readable and support CPU recovery. This increases
corner radius and separation rather than padding the opening straights.

The adopted shape comparison (machine reference on fresh Soft, not human lap times):

| Circuit | Previous length | Current length | Previous reference | Current reference |
| --- | ---: | ---: | ---: | ---: |
| Pitwall GP | 8.07 km | 2.90 km | 82.1 s | 33.5 s |
| Velocity Park | 8.37 km | 1.97 km | 79.8 s | 19.8 s |
| Switchback Ring | 7.74 km | 1.76 km | 78.8 s | 21.2 s |
| Sakura Esses | 7.61 km | 1.66 km | 73.9 s | 21.9 s |
| Harbor Chicane | 7.74 km | 2.17 km | 82.4 s | 31.2 s |

Rejected alternatives: simply deleting Pitwall's extension at its smallest
footprint restores an ambiguous projection beside the technical section;
shrinking every track indiscriminately would erase Baku's intended character.
Serra and Baku therefore keep their geometry. The old extended Pitwall AUTO
corner-speed allowance is disabled on Compact geometry: its lap-progress
windows no longer describe the same complexes. CPU cars use the physical
reference speed instead.

All six fictional circuits now use the existing Compact pit profile (1.2 s
service, abstract 130 km/h limiter); Baku keeps the Standard profile. These are
an interim coherent baseline, not the completed pit-strategy rebalance. Issue
#137 remains open for physical net-loss measurements and strategy tuning.

The strategy harness's normalization baseline stays on Standard Baku so changing
the default Pitwall layout does not silently multiply tyre effects everywhere.
The existing one-stop/two-stop benchmark still covers Compact Serra and Standard
Baku; its three-second guard is not proof that the new circuits feel balanced.

This is a product decision: **layout quality comes first**. A circuit should be made longer because the intended racing needs more space, not because a global stopwatch target says every lap must approach 90 seconds. Target lap time is a design constraint only when deliberately chosen for that circuit.

Compact layouts do create more frequent traffic and lapping opportunities because the field crosses the same point more often. That is treated as a format characteristic to monitor with the physical pack tests, not a reason to stretch every track. The current eight-car field remains the baseline; if a future Compact layout becomes traffic-saturated, field size or event format should be tuned explicitly for that circuit rather than lengthening good corners with low-interaction straights.

## Balance gates

Game design is treated as testable behaviour, not just tuning by intuition. Lightweight deterministic simulations and physical-pack tests protect the core loop.

The core-race suite should fail when any of these become true:

- the dry two-compound rule can be bypassed,
- one compound gains its advantage mainly through straight-line engine power,
- a worn tyre loses straight-line power instead of mainly losing braking / cornering authority,
- a sensible pit stop has no meaningful pace benefit,
- a normal Medium stint collapses absurdly early in a longer race,
- AI pace falls behind a competent player because it brakes too early everywhere,
- AI gains difficulty through a giant top-speed cheat instead of sustained lap pace,
- speed presentation becomes visually slow again,
- AI starts leaving the circuit or returning to continuous contact vibration.

These tests are **guardrails, not an oracle**. Human play feel remains authoritative.

## Architecture

The simulation is independent from rendering. `simulation/` owns authoritative vehicle, tyre, track, timing and race state; Three.js consumes that state and renders it.

- Simulation: fixed 120 Hz
- Rendering: display refresh rate
- Renderer: Three.js / WebGL
- Camera: fixed-orientation elevated orthographic camera; follows position, not heading
- HUD: HTML/CSS overlay
- Physics: Rapier 2D dynamic rigid bodies for player and AI
- Vehicle dynamics: purpose-built arcade-formula controller layered over Rapier velocity/contact solving
- AI: physical throttle / brake / steering controller locked to the active reference line; traffic only affects longitudinal following
- Track: selectable closed Catmull–Rom circuit shared by projection, AI and presentation
- Race truth: lap, compound legality, order, traffic state and strategy live outside rendering
- Balance harness: deterministic strategy tests plus fast, gameplay and long-running physical regression tiers

## Current playable controls

Everything needed during a race is reachable with the left hand:

- `WASD` — drive
- `Q` Soft / `E` Medium / `R` Hard for the next stop
- `F` box this lap
- `C` recover or restart

There are no live energy-mode keys in the current core-race build.

## Milestones

### M0 — handling laboratory ✅
- top-down WebGL scene
- driveable formula car
- S/M/H tyre model
- temperature, wear, grip and cliff

### M1 — race core ✅ first vertical slice
- checkpoint-validated lap counting
- 8-car physical field
- live classification
- current / last / best lap timing
- physical pit request and compound selection
- two-compound dry-race rule
- adaptive AI tyre strategies

### M2 — racing feel — current priority
- fixed-isometric 3D presentation ✅
- Rapier physical field ✅
- AI reference-line driving with longitudinal FOLLOW traffic control ✅
- driver pace / consistency / precision profiles with smooth live execution variation ✅
- high-speed braking and cornering skill requirement ✅ ongoing tuning
- speed-perception telemetry ✅
- stronger AI without straight-line compound cheats ✅
- core handling and difficulty tuning ⏳ ongoing

### M3 — race structure — current priority
- pre-race setup screen ✅
- standalone Time Trial ✅
- one-shot qualifying / skip-qualifying flow ✅
- starting tyre selection ✅
- duration-based SHORT / STANDARD / LONG race lengths ✅
- explicit Compact / Standard / Long physical circuit profiles ✅
- AUTO / PLAYER BEST CPU racing-line selection ✅
- compact qualifying-derived starting grid ✅
- unified road edge / runoff / barrier language ✅ first model
- longer-race tyre strategy balance ⏳ ongoing
- richer circuit-specific environment identity ⏳

### M4 — strategy polish
- physical AI and player pit stops ✅
- undercut / overcut reaction to traffic ✅ first model
- tyre warm-up after pit stops ✅ implicit, needs tuning
- richer pit/strategy feedback ⏳
- energy management ⏸ parked until core race is fun

### M5 — spectacle
- sound and speed-sensitive mix ✅ first model
- polished car art ⏳
- richer environment art ⏳
- more circuit identity / presentation ⏳

## Explicitly deferred complexity

These are not priorities until the basic race is demonstrably fun:

- HARVEST / NORMAL / DEPLOY energy management
- detailed four-wheel tyre simulation
- fuel strategy
- full FIA rule simulation
- setup engineering screens
- safety car / VSC
- rain and wet-weather tyre systems
- damage simulation
- multiplayer

## Immediate design risks

1. More speed is useful only if braking points and track readability remain understandable.
2. AI must be hard because it drives well, not because it owns a different engine.
3. Duration-based races must create meaningful stints without turning old tyres into undriveable switches.
4. PLAYER BEST and AUTO lines must remain physically coherent across compounds and through the start/finish seam.
5. All seven circuits must remain valid for projection, pits, compact grids, CPU driving and camera — not just render different shapes.
6. The fixed camera must preserve GeneRally-style clarity while still selling 300+ km/h.
7. Automated balance results must never replace actual playtesting; they only detect objective regressions.
