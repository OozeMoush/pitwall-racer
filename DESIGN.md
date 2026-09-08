# Pitwall Racer — Design

## Product thesis

Pitwall Racer is a **top-down racing game first**. It borrows the parts of Formula racing that create interesting decisions, but realism is never the goal by itself.

The primary strategic decision is: **how much future tyre life are you willing to spend for lap time now?**

The second resource follows the same philosophy: **extra electrical power is only useful if you saved or harvested the energy first.**

A good session should produce thoughts such as “I pushed one lap too long”, “I should undercut now”, “I need to cool the tyres before attacking again”, or “I wasted OVERTAKE before the straight”. If PUSH or OVERTAKE is always optimal, the design has failed.

## Non-negotiable race rule

The dry-race **two-compound tyre requirement stays**. It is not present for realism alone: it forces at least one meaningful strategy decision and prevents a single-compound dominant solution.

## Product priority

When choosing work, use this order:

1. Driving must feel good within seconds.
2. Overtaking and defending must create readable, satisfying battles.
3. Tyre condition must be felt through the car, not only read from telemetry.
4. Pit and compound choices must create regret, risk and opportunity.
5. Only then add more Formula-like systems.

Every proposed feature must pass one question: **does this make the race more fun, or merely more realistic?** If the answer is only realism, defer it.

## Architecture

The simulation is independent from rendering. `simulation/` owns authoritative vehicle, tyre, energy, track, timing and race state; Phaser consumes that state and renders it. This lets us later run headless strategy simulations for balancing.

- Simulation: fixed 120 Hz for the player model
- Rendering: display refresh rate
- Renderer: Phaser/WebGL
- HUD: HTML/CSS overlay
- Vehicle dynamics: purpose-built lightweight arcade-formula model, not generic rigid-body physics
- AI: racing-line progress model, intentionally cheaper than the player vehicle model
- Track: closed Catmull–Rom spline shared by projection, AI motion and presentation
- Race truth: lap, compound legality, order, traffic state, energy and strategy live outside Phaser rendering

The asymmetric player/AI model is deliberate. The player needs tactile handling; the field needs believable race behaviour at low CPU cost.

## Milestones

### M0 — handling laboratory ✅
- top-down WebGL scene
- driveable formula car
- S/M/H tyre model
- temperature, wear, grip and cliff
- conserve/balanced/push modes

### M1 — race core ✅ first vertical slice
- smooth authored racing line and track-distance projection ✅
- checkpoint-validated lap counting ✅
- 8-car field ✅
- live classification ✅
- current / last / best lap timing ✅
- pit request and compound selection ✅
- two-compound dry-race rule ✅
- adaptive AI tyre strategies ✅
- AI follow / attack / overtaking lanes ✅

### M2 — racing feel — current priority
- player/AI space ownership and soft contact ✅ first model
- contact speed loss and camera feedback ✅ first model
- tyre wear reduces turn-in confidence ✅ first model
- tyre wear lengthens braking zones ✅ first model
- side-by-side and contact HUD feedback ✅ first model
- better player/AI defending behaviour ⏳
- forgiving recovery after minor contact ⏳
- controller/gamepad input ⏳
- driving balance and difficulty tuning ⏳

### M3 — strategy polish
- dirty air vs tow ✅ first model
- undercut / overcut reaction to traffic ✅ first model
- tyre warm-up after pit stops ✅ implicit, needs tuning
- finite energy storage and regenerative harvest ✅ first model
- hold-to-use OVERTAKE deployment ✅ first model
- physical pit-lane presentation ⏳
- clearer pre-race tyre strategy choice ⏳

### M4 — spectacle
- speed-sensitive camera look-ahead / zoom ✅
- skid marks ✅
- tyre smoke ✅
- off-track/contact shake ✅
- smooth spline-driven road presentation ✅
- sound and speed-sensitive mix ⏳
- polished car art ⏳
- richer environment art ⏳

## Explicitly deferred complexity

These are not priorities until the basic race is demonstrably fun:

- detailed four-wheel tyre simulation
- fuel strategy
- complex engine modes
- full FIA rule simulation
- setup engineering screens
- safety car / VSC
- rain and wet-weather tyre systems
- damage simulation
- qualifying systems
- multiplayer

## Immediate design risks

1. AI still uses an abstract progress model, so physical interaction with the player's car must stay stable and readable rather than perfectly realistic.
2. The current pit stop is abstracted as time loss; this is acceptable until pit-lane presentation materially improves gameplay.
3. Dirty air must create tension without making following frustrating.
4. Manual steering must remain forgiving enough that strategy decisions still fit in the player's mental bandwidth.
5. Energy deployment must not become a second always-on throttle button.
6. Tire effects must be strong enough to feel, but not so strong that a worn car becomes unpleasant or impossible to recover.
