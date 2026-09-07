# Pitwall Racer — Design

## Product thesis

Pitwall Racer is not a generic top-down racer with a tyre widget. The core decision is: **how much future tyre life are you willing to spend for lap time now?**

A good session should produce thoughts such as “I pushed one lap too long”, “I should undercut now”, or “I need to cool the fronts before attacking again”. If PUSH is always optimal, the design has failed.

## Architecture

The simulation is independent from rendering. `simulation/` owns authoritative vehicle, tyre, track and race state; Phaser consumes that state and renders it. This lets us later run thousands of headless strategy simulations for balancing.

- Simulation: fixed 120 Hz for the player model
- Rendering: display refresh rate, interpolation later
- Renderer: Phaser/WebGL
- HUD: HTML/CSS overlay
- Vehicle dynamics: purpose-built lightweight model, not generic rigid-body physics
- AI: racing-line progress model, intentionally cheaper than the player vehicle model
- Race truth: lap, compound legality, order and aero traffic effects live outside Phaser rendering

The asymmetric player/AI model is deliberate. The player needs tactile handling; the field needs believable race behaviour at low CPU cost.

## Milestones

### M0 — handling laboratory ✅
- top-down WebGL scene
- driveable formula car
- S/M/H tyre model
- temperature, wear, grip and cliff
- conserve/balanced/push modes

### M1 — race — in progress
- authored racing line and track-distance projection ✅
- checkpoint-validated lap counting ✅
- 8-car field ✅
- basic AI tyre strategies ✅
- pit request and compound selection ✅
- two-compound dry-race rule ✅
- live classification ✅
- real sector/lap timing ⏳
- track-limit penalties ⏳
- proper pit-lane path and pit loss ⏳

### M2 — F1-shaped strategy — started early
- dirty air vs tow ✅ first model
- undercut/overcut ⏳
- tyre warm-up after pit stops ✅ implicit in tyre model, needs stronger tuning
- energy deployment / overtake mode ⏳
- race engineer messages ⏳

### M3 — spectacle
- camera look-ahead
- skid marks, smoke, sparks, kerb shake
- sound and speed-sensitive mix
- polished car/track art

## Immediate design risks

1. AI uses an abstract progress model, so traffic currently looks like a race before it fully behaves like one. Overtake interaction needs explicit lane decisions next.
2. The pit stop currently models time loss rather than a physical pit lane. Good for strategy validation, not final presentation.
3. Dirty air must hurt cornering enough to create tyre-management tension without making following impossible.
4. Manual steering must remain forgiving enough that strategy decisions still fit in the player's mental bandwidth.

Weather, safety cars and multiplayer are deliberately deferred until the dry-race strategy loop is demonstrably fun.
