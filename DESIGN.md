# Pitwall Racer — Design

## Product thesis

Pitwall Racer is not a generic top-down racer with a tyre widget. The core decision is: **how much future tyre life are you willing to spend for lap time now?**

The second resource follows the same philosophy: **extra electrical power is only useful if you saved or harvested the energy first.**

A good session should produce thoughts such as “I pushed one lap too long”, “I should undercut now”, “I need to cool the fronts before attacking again”, or “I wasted OVERTAKE before the straight”. If PUSH or OVERTAKE is always optimal, the design has failed.

## Architecture

The simulation is independent from rendering. `simulation/` owns authoritative vehicle, tyre, energy, track, timing and race state; Phaser consumes that state and renders it. This lets us later run thousands of headless strategy simulations for balancing.

- Simulation: fixed 120 Hz for the player model
- Rendering: display refresh rate, interpolation later
- Renderer: Phaser/WebGL
- HUD: HTML/CSS overlay
- Vehicle dynamics: purpose-built lightweight model, not generic rigid-body physics
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
- track-limit penalties ⏳
- physical pit-lane path and realistic pit loss ⏳

### M2 — F1-shaped strategy — in progress
- dirty air vs tow ✅ first model
- undercut / overcut reaction to traffic ✅ first model
- tyre warm-up after pit stops ✅ implicit in tyre model, needs stronger tuning
- finite energy storage and regenerative harvest ✅ first model
- hold-to-use OVERTAKE deployment ✅ first model
- player-facing race engineer messages ⏳
- richer AI energy strategy ⏳

### M3 — spectacle — in progress
- speed-sensitive camera look-ahead / zoom ✅
- skid marks ✅
- tyre smoke ✅
- off-track shake ✅
- smooth spline-driven road presentation ✅
- sparks ⏳
- sound and speed-sensitive mix ⏳
- polished car art ⏳
- richer environment art ⏳

### Later systems
- track-limit and flag system
- safety car / VSC
- rain, intermediate and wet tyres
- damage
- qualifying / grid generation
- multiplayer only after the single-player race loop is stable

## Immediate design risks

1. AI uses an abstract progress model. Its strategic behaviour is now richer, but interaction with the player's physically driven car can still look ghost-like until collision/space ownership is modeled.
2. The pit stop currently models time loss rather than a physical pit lane. Good for strategy validation, not final presentation.
3. Dirty air must hurt cornering enough to create tyre-management tension without making following impossible.
4. Manual steering must remain forgiving enough that strategy decisions still fit in the player's mental bandwidth.
5. Energy deployment must not become a second always-on throttle button. Battery availability and useful deployment zones need balancing.
6. The tyre and energy models are game-facing abstractions. Exact FIA parameters should only be introduced where they improve decisions rather than complexity for its own sake.

Weather, safety cars and multiplayer remain deliberately deferred until the dry-race strategy loop is demonstrably fun.
