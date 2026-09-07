# Pitwall Racer — Design

## Product thesis

Pitwall Racer is not a generic top-down racer with a tyre widget. The core decision is: **how much future tyre life are you willing to spend for lap time now?**

A good session should produce thoughts such as “I pushed one lap too long”, “I should undercut now”, or “I need to cool the fronts before attacking again”. If PUSH is always optimal, the design has failed.

## Architecture

The simulation is independent from rendering. `simulation/` owns authoritative vehicle and tyre state; Phaser consumes that state and renders it. This lets us later run thousands of headless strategy simulations for balancing.

- Simulation: fixed 120 Hz
- Rendering: display refresh rate, interpolated later
- Renderer: Phaser/WebGL
- HUD: HTML/CSS overlay
- Vehicle dynamics: purpose-built lightweight model, not generic rigid-body physics

## Milestones

### M0 — handling laboratory
- top-down WebGL scene
- driveable formula car
- S/M/H tyre model
- temperature, wear, grip and cliff
- conserve/balanced/push modes

### M1 — race
- authored circuit spline and track limits
- lap/sector timing
- 8–12 AI cars
- overtaking and traffic
- pit lane and compound selection
- two-compound dry-race rule

### M2 — F1-shaped strategy
- dirty air vs tow
- undercut/overcut
- tyre warm-up after pit stops
- DRS/overtake-energy abstraction
- race engineer messages

### M3 — spectacle
- camera look-ahead
- skid marks, smoke, sparks, kerb shake
- sound and speed-sensitive mix
- polished car/track art

Weather, safety cars and multiplayer are deliberately deferred until the dry-race strategy loop is demonstrably fun.
