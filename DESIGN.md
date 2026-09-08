# Pitwall Racer — Design

## Product thesis

Pitwall Racer is a **top-down racing game first**. It borrows the parts of Formula racing that create interesting decisions, but realism is never the goal by itself.

The primary strategic decision is: **how much future tyre life are you willing to spend for lap time now?**

That tyre cost should come mainly from what the player actually does — speed, steering load, braking and fighting another car — rather than from a separate magical pace switch.

The second resource follows the same philosophy: **electrical energy is race time stored for later**. HARVEST gives up pace to gain charge, NORMAL is sustainable, and DEPLOY spends that charge for an obvious attack window.

A good session should produce thoughts such as “I braked too late all stint”, “I should undercut now”, “I need one harvest section before I attack”, or “I burned DEPLOY too early”. If one hybrid mode, one compound or one pit lap is always optimal, the design has failed.

## Non-negotiable race rule

The dry-race **two-compound tyre requirement stays**. It is not present for realism alone: it forces at least one meaningful strategy decision and prevents a single-compound dominant solution.

## Product priority

When choosing work, use this order:

1. Driving must feel good within seconds.
2. Overtaking and defending must create readable, satisfying battles.
3. Tyre condition must be felt through the car, not only read from telemetry.
4. Pit, compound and hybrid choices must create regret, risk and opportunity.
5. Only then add more Formula-like systems.

Every proposed feature must pass one question: **does this make the race more fun, or merely more realistic?** If the answer is only realism, defer it.

## Balance gates

Game design is treated as testable behaviour, not just tuning by intuition. Lightweight deterministic simulations and focused unit tests protect the core loop.

The balance suite should fail when any of these become true:

- the dry two-compound rule can be bypassed,
- harder tyre usage stops buying immediate pace or stops costing meaningful life,
- one legal strategy separates so far from the field that alternative pit/compound choices stop mattering,
- HARVEST stops charging under normal keyboard driving,
- NORMAL empties the battery merely because W is held,
- DEPLOY stops giving a meaningful pace advantage or stops costing charge,
- future tuning turns a single compound, fixed stop lap or permanent hybrid mode into the obvious answer.

These tests are **guardrails, not an oracle**. Human play feel remains authoritative.

## Architecture

The simulation is independent from rendering. `simulation/` owns authoritative vehicle, tyre, energy, track, timing and race state; Three.js consumes that state and renders it.

- Simulation: fixed 120 Hz for the player model
- Rendering: display refresh rate
- Renderer: Three.js / WebGL
- Camera: fixed-orientation elevated orthographic camera; follows position, not heading
- HUD: HTML/CSS overlay
- Vehicle dynamics: purpose-built lightweight arcade-formula model, not generic rigid-body physics
- AI: racing-line progress/lane model, intentionally cheaper than the player vehicle model
- Track: closed Catmull–Rom spline shared by projection, AI motion and presentation
- Race truth: lap, compound legality, order, traffic state, energy and strategy live outside rendering
- Balance harness: deterministic headless stint/race model reusing the tyre model

The asymmetric player/AI model is deliberate. The player needs tactile handling; the field needs believable race behaviour at low CPU cost. That asymmetry is acceptable only while cars respect visible space and AI behaves like a race opponent rather than a moving timing bar.

## Current playable controls

Everything needed during a race is reachable with the left hand:

- `WASD` — drive
- `1` HARVEST / `2` NORMAL / `3` DEPLOY
- `Q` Soft / `E` Medium / `R` Hard
- `F` box this lap
- `C` recover or restart

## Milestones

### M0 — handling laboratory ✅
- top-down WebGL scene
- driveable formula car
- S/M/H tyre model
- temperature, wear, grip and cliff

### M1 — race core ✅ first vertical slice
- smooth authored racing line and track-distance projection ✅
- checkpoint-validated lap counting ✅
- 8-car field ✅
- live classification ✅
- current / last / best lap timing ✅
- pit request and compound selection ✅
- two-compound dry-race rule ✅
- adaptive AI tyre strategies ✅

### M2 — racing feel — current priority
- fixed-isometric 3D presentation ✅ first model
- player/AI space ownership and soft contact ✅ first model
- soft contact without positional buzzing ✅ current model
- strong high-speed steering falloff and brake-point requirement ✅ current model
- multi-lane AI occupancy ✅ current model
- AI follow / attack / defend / side-by-side states ✅ first model
- AI pass completion instead of permanent train capping ✅ current model
- driving balance and difficulty tuning ⏳ ongoing
- controller/gamepad input ⏳ deferred until keyboard core is fun

### M3 — strategy polish
- deterministic headless strategy simulator ✅ first model
- balance-regression tests for tyre cost / legal strategies ✅ first model
- dirty air vs tow ✅ first model
- undercut / overcut reaction to traffic ✅ first model
- tyre warm-up after pit stops ✅ implicit, needs tuning
- HARVEST / NORMAL / DEPLOY energy modes ✅ current model
- physical pit-lane presentation ✅ first model
- clearer pre-race tyre strategy choice ✅ first model

### M4 — spectacle
- fixed elevated top-down camera ✅
- 3D formula cars / track environment ✅ first model
- dense kerbs / roadside speed references ✅ first model
- sound and speed-sensitive mix ⏳
- polished car art ⏳
- richer environment art ⏳

## Explicitly deferred complexity

These are not priorities until the basic race is demonstrably fun:

- detailed four-wheel tyre simulation
- fuel strategy
- extra engine sub-modes beyond the simple three-way hybrid decision
- full FIA rule simulation
- setup engineering screens
- safety car / VSC
- rain and wet-weather tyre systems
- damage simulation
- qualifying systems
- multiplayer

## Immediate design risks

1. AI still uses an abstract progress model, so physical interaction with the player's car must stay stable and readable rather than perfectly realistic.
2. AI pace must be high enough to create pressure without requiring hidden rubber-banding.
3. Dirty air must create tension without making following frustrating.
4. Keyboard steering must remain forgiving at low speed while making high-speed braking necessary.
5. HARVEST / NORMAL / DEPLOY must each have a clear use case; none can become the permanent default.
6. Tyre effects must be strong enough to feel, but not so strong that a worn car becomes unpleasant or impossible to recover.
7. Headless balance results must never replace actual playtesting; they only detect obvious regressions and dominant-strategy failures.
