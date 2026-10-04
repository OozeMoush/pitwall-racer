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

The strategy harness normalizes per-lap tyre/slide effects by representative lap duration and a fixed format coefficient. Pit cost is an independent input: changing it must change only the cost of each stop, never tyre wear or on-track pace. The inherited Compact coefficient (0.35) remains an approximate harness calibration; it is not a measurement of physical tyre benefit.

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

### Pit calibration — Issue #137, measurement slice

Player and CPU service timers must use the same circuit profile. The player
previously retained a fixed 2.5 s service despite Compact CPUs using 1.2 s;
that mismatch is corrected. Track-limit service penalties remain additive.

Harbor's default entry at 0.91 carried its offset pit route around the tight
start-line turn, folding the path into road barriers and stranding a physical
player. Its entry is now 0.75 on the existing straight. Lane length, corner
geometry and exit-side control remain unchanged.

Historical PR #140 entry-to-exit measurements use fresh Medium, 88 m/s entry speed,
no traffic and no penalty. The player holds throttle with the live pit assist;
its mainline comparison uses the unassisted shared chassis reference. CPU
mainline driving uses the same fixed driver in isolation. These are repeatable
instrumented controls, not human lap times or an optimal pit execution claim.
They exclude the approach before entry and recovery after exit.

| Circuit | Player pit total | Player net loss | CPU pit total | CPU net loss |
| --- | ---: | ---: | ---: | ---: |
| Pitwall GP | 16.40 s | 11.41 s | 10.69 s | 5.83 s |
| Velocity Park | 15.17 s | 11.10 s | 10.69 s | 6.71 s |
| Switchback Ring | 15.18 s | 10.69 s | 10.69 s | 6.28 s |
| Sakura Esses | 15.12 s | 10.01 s | 10.69 s | 5.86 s |
| Harbor Chicane | 13.87 s | 10.12 s | 10.69 s | 7.13 s |
| Serra Circuit | 15.17 s | 10.63 s | 10.69 s | 6.23 s |
| Baku Street | 25.44 s | 20.48 s | 24.12 s | 19.26 s |

Compact candidate measurements at Pitwall:

| Limiter / service | Player net loss | CPU net loss |
| --- | ---: | ---: |
| 100 km/h / 2.5 s | 15.59 s | 9.97 s |
| 130 km/h / 1.2 s (retained) | 11.41 s | 5.83 s |
| 160 km/h / 0.8 s | 9.21 s | 3.66 s |

The fast candidate saves player time but increases the player/CPU disparity.
The slow candidate adds dead transit time. Neither resolves the underlying
execution mismatch, so keep the current profile while measuring that problem.
That historical CPU baseline used clock-driven placement. CPU transit now
uses the player's shared pit assist and real rigid-body braking, steering and
acceleration. Progress toward the box and exit follows the observed body pose;
only the same final service docking correction may place the body. Exit keeps
actual velocity. Planned CPUs brake over the last 200 m, follow the normal
line above 65 m/s, then merge toward the entry. They must meet the same
physical entry-side gate as the player. Pit approach/transit uses the shared
chassis baseline, without race-CPU grip/power advantages. Ordinary race
driving retains its stable constructor advantage.

Updated isolated fresh-Medium measurements (no tyre benefit or penalty):

| Circuit | Player pit total | Player net loss | CPU pit total | CPU net loss |
| --- | ---: | ---: | ---: | ---: |
| Pitwall GP | 16.40 s | 10.59 s | 15.33 s | 7.08 s |
| Velocity Park | 15.18 s | 11.15 s | 13.98 s | 10.22 s |
| Switchback Ring | 15.18 s | 10.86 s | 14.98 s | 10.97 s |
| Sakura Esses | 15.13 s | 10.28 s | 14.01 s | 9.43 s |
| Harbor Chicane | 13.87 s | 9.75 s | 13.63 s | 9.40 s |
| Serra Circuit | 15.18 s | 10.66 s | 13.94 s | 9.68 s |
| Baku Street | 25.44 s | 20.75 s | 24.48 s | 19.91 s |

The mainline controls now warm up from 260 m before entry. CPU also approaches
from there at 88 m/s; the player pit control still starts at entry at 88 m/s.
The reported pit totals start at entry and end at exit, so they exclude approach
and recovery. Net losses use each control's own same-section mainline timing.
These are not identical initial entry states or evidence of equal overall
strategy costs. Do not compare the historical net values as unchanged controls.
All seven routes enter on the requested lap, complete service and exit;
controlled transit durations differ by less than 1.5 s. A pinned body must not
reach service just because time passes. Full races include approach/recovery,
but isolated runs cannot establish traffic or human balance.

Pitwall 48-lap physical runs with fixed CONTROL skill 1.127, start progress
0.02 / speed 72 m/s and no traffic completed every planned stop:

| Plan | Pit laps | Race time | Deep-cut sample ratio |
| --- | --- | ---: | ---: |
| M-H | 16 | 1755.45 s | 0.83% |
| H-M | 32 | 1762.53 s | 0.88% |
| H-M-H | 19 / 32 | 1744.90 s | 0.18% |
| H-S-H | 19 / 29 | 1743.42 s | 0.41% |

These include physical approach and recovery. The best tested two-stop gains
12.03 s over the best tested one-stop; this is a result for four fixed plans,
not an exhaustive optimum or a calibration of the approximate harness.

The old lane-length / fixed 80 m/s mainline subtraction estimates Compact net
loss as 6.40 s on every circuit. That is not a calibrated player cost. Keep the
estimate labeled as approximate; do not infer balance from it alone.

The independent harness predicts its best two-stop relative to best one-stop
at Pitwall as -0.25 s with 6 s pit cost, +4.75 s with 11 s, and +13.75 s with
20 s. The same plans keep identical tyre wear and lap times across those
experiments. These estimates explain why the earlier near-tie was misleading;
physical strategy tests and human traffic/tyre feedback remain required.

This is a product decision: **layout quality comes first**. A circuit should be made longer because the intended racing needs more space, not because a global stopwatch target says every lap must approach 90 seconds. Target lap time is a design constraint only when deliberately chosen for that circuit.

Compact layouts do create more frequent traffic and lapping opportunities because the field crosses the same point more often. That is treated as a format characteristic to monitor with the physical pack tests, not a reason to stretch every track. The current eight-car field remains the baseline; if a future Compact layout becomes traffic-saturated, field size or event format should be tuned explicitly for that circuit rather than lengthening good corners with low-interaction straights.

### Matched approach/recovery controls — Issue #137

Stop/no-stop controls now begin 260 m before entry at the identical centreline
pose, 88 m/s and fresh Medium, with no traffic or penalty. Physical progress
gates end at exit, then +200/+400/+600 m. Each car has its own matching no-stop
baseline; CPU retains normal fixed race advantages outside pit approach/transit.
The player is instrumented with reference steering, a scripted braking/merge
approach, and the live `CoreRaceGame.stepPhysicalPit` method. This is repeatable
automation, not human execution or equal CPU/player road performance.

That new player approach reproduced a Harbor stall before service: at pit
t=0.270 the car was about 3.1 m off the route and almost stationary. Starting
directly at entry hid this failure. The shared assist now caps speed for the
upcoming pit-route bend using a 12 m/s² lateral-acceleration budget and the
existing lookahead. The exit merge keeps its prior speed target. This fixes the
approach regression without teleporting, enlarging the docking gate or changing
service/limiter profiles. Both controlled cars complete all seven routes.

Measured net loss after the bend-control fix (seconds, same-section subtraction):

| Circuit | CPU at exit | CPU +600 m | Player at exit | Player +600 m |
| --- | ---: | ---: | ---: | ---: |
| Pitwall GP | 8.57 | 10.34 | 10.52 | 12.26 |
| Velocity Park | 12.87 | 15.08 | 12.70 | 14.81 |
| Switchback Ring | 12.65 | 14.08 | 12.46 | 13.72 |
| Sakura Esses | 12.74 | 14.46 | 12.30 | 14.17 |
| Harbor Chicane | 10.58 | 12.00 | 10.95 | 12.42 |
| Serra Circuit | 12.69 | 14.64 | 12.53 | 14.53 |
| Baku Street | 22.49 | 25.03 | 21.52 | 23.86 |

The verbose `PitEconomicsPlaytest` logs retain all intermediate gate times and
speeds. +600 m is a reporting boundary, not a claim that recovery has finished:
Pitwall CPU still has a ~5.6 m/s speed deficit and Baku ~12.4 m/s. Several other
circuits meet a corner before that boundary and lose the acceleration deficit.
CPU tyre wear is held fixed in this isolated cost experiment; the live player
pit method retains its small transit wear and refreshes the same compound.
Full worn-tyre races must supply the tyre-benefit evidence separately.

Rejected alternatives: a global pit-time adjustment cannot describe the
circuit-specific mainline pace and acceleration recovery; requiring every
track to recover by 600 m would manufacture an invariant. A slower exit merge
was also excluded because it adds avoidable time when rejoining traffic.
The fixed-speed Compact estimate (6.40 s) and harness response coefficient
remain uncalibrated. Do not use their near-tie as physical balance evidence.
The following comparison establishes the executable strategy gate. Human feel
and broader traffic coverage remain open in Issue #137.

### Physical strategy authority — Issue #137

Strategy balance is judged with the live tyre model, controller and Rapier
physics. `StrategySimulator` is an **unvalidated approximation**, useful for
cheap sensitivity experiments but unused by the game. Do not fit its format
coefficient to a few race totals or require its synthetic three-second tie as
a gameplay invariant. This avoids duplicating physical tyre/recovery behavior
in a second model. Pit-cost input remains independent of its tyre effects.

The shared test runner can hold stop laps fixed to isolate stop economics, or
allow the live controller to react to traffic. Every normal full-race plan must
finish, use two compounds, enter on the requested laps and keep deep-cut samples
below 3%. Fixed plans retain live wear, pace, braking, pit transit and recovery.

Current isolated reference results (CONTROL skill 1.127, start progress 0.02,
72 m/s, no traffic; stop numbers denote **entry on that lap**):

| Circuit / race | Plan | Race time |
| --- | --- | ---: |
| Pitwall / 48 laps | M-H@14 | 1767.33 s |
| Pitwall / 48 laps | M-H@16 | 1759.35 s |
| Pitwall / 48 laps | M-H@18 | 1750.25 s |
| Pitwall / 48 laps | H-M@32 | 1763.25 s |
| Pitwall / 48 laps | H-M-H@19/32 | 1746.30 s |
| Pitwall / 48 laps | H-S-H@19/29 | 1745.13 s |
| Baku / 18 laps | M-H@6 | 1407.68 s |
| Baku / 18 laps | H-M-H@7/12 | 1436.45 s |

An extra stop gains 14.22 s against M-H@16, but only 5.12 s against M-H@18.
On the tested Baku plans it loses 28.77 s. These are sampled windows, not global
optima. Broad regression bounds protect useful tyre benefit and viable nearby
windows without forcing every circuit to produce the same winner.

With a 10.34 s Compact pit-cost input, the approximation predicts H-S-H to
lose 5.90 s against M-H@16, opposite to the physical result. Its stops occur
**after** whole laps rather than within the entry lap; both conventions are
logged. This comparison exposes the approximation's limits, not calibration
agreement. No physical tyre coefficients or pit timers were changed to fit it.

Traffic alone does not justify an undercut: a healthy Medium-to-Hard change
can lose clean-air pace. CPU early calls now require the existing late-wear
region (56% wear), with useful life remaining, and commit to the current lap
inside the two-lap window. A 120 s controlled Pitwall traffic experiment keeps
45%-worn Medium on its planned lap 14; at 60% wear it stops on lap 12 and gains
0.161 lap over the forced late control. The deliberately worn late control
enters the tyre cliff and exceeds the normal path-error bound; the adaptive
case stays below 3% and improves both progress and path error. That diagnostic
does not relax the normal full-race guards or prove optimal decisions for all
compound combinations. Human tyre feedback and pack racing remain required.

### Player pit capture — Issue #143

A requested physical pit entry commits to AUTO PIT: the shared controller owns
throttle, braking and steering until the exit. The driver chooses the request,
compound and entry line; requiring continued W or a precisely released turn
inside the lane adds no useful racing decision. With the old player input blend,
releasing W at 22 m/s stranded the vehicle before service on all seven circuits.
Input-independent transit still uses the real rigid body and spatial progress;
only the final docking correction may place it at the box. Pinning the body
before the box must prevent service. Shared CPU/player timers and exit velocity
remain unchanged. The HUD identifies AUTO PIT and the actual circuit limiter.

The old crossing-only gate also rejected a correct merge just after the entry
tick. Player capture now requires a request, the entry-side offset, forward
alignment within 60 degrees, and a body centre on the actual rendered pit
ribbon. Its bounded entry window covers the first 30 mainline metres and first
8% of the route; a ribbon-width allowance before the nominal mainline entry
accounts for offset-route projection. Mainline, opposite direction, reverse
progress, unrequested and missed-ramp poses are rejected. The ribbon half-width
is owned by the simulation and shared with rendering. CPU entry scheduling is
unchanged.

Rejected alternatives: a broad road-distance trigger could capture an armed car
that stays on the mainline; increasing box tolerance cannot repair a car stopped
upstream; snapping a car to the route or advancing transit by time would hide
physical stalls. The retained gate checks actual route proximity and limits the
late merge window instead. Automated coverage includes entry and late-entry
poses, 22/40/65 m/s, both lateral offsets, heading deviations, released pedals,
held steering and simultaneous throttle/brake on all seven circuits. This
reproduces concrete failure classes without claiming every human approach is
covered.

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
