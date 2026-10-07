# Issue #153 — first pair passing experiment

Status: rejected candidate, retained as a reproducible research checkpoint.
Baseline: main `78c2b55` (PR #172). No production code imports this experiment.

## Conditions and interpretation

Pitwall GP AUTO, fixed 120 Hz, 12 seconds per case; CPU at progress 0.04,
75 m/s; controlled player-body rival 40 m ahead at 65 m/s. Both use the same
Medium tyre grip and +0.22 power input, with normal surface penalties. No pit,
tyre evolution, damage, tow/dirty air, recovery assist or player-position
rubber-banding. This is a controlled controller experiment, not a full GP.

Before uses the existing DynamicAiController's steering/pedals. After uses the
same controller until a passing state is active, then the isolated lane policy,
point steering and a speed servo. Thus the measured candidate includes both
planning and execution changes; it does not isolate the planner's effect.
Rival uses AUTO steering/pedals plus a 65 m/s cap; defensive case steers toward
lane -6 for the first three seconds; equal case raises its cap to 100 m/s.
“Equal” means smaller available pace advantage, not mathematically equal speed.

Contact means an actual nonpositive-distance Rapier manifold involving either
dynamic body, including barriers and gentle rubbing. Offroad time is either
body's oriented half-width/half-length envelope beyond the local road edge:
this is stricter than the GP four-wheels-off warning rule. Stall is either car
below 2 m/s. Pass means the ego first achieves 18 m clearance; it is not a
completed manoeuvre until RETURN finishes as FOLLOW. Return/abort metrics are
candidate states; baseline has no such manoeuvre state machine.

Each after run is repeated and all physics/transition measurements compared
exactly. CPU cost is mean controller time after one-second warm-up, excluding
Rapier/contact instrumentation and rival controls; not a browser FPS claim.

## Result

| Scenario | Contact seconds before → after | Envelope departure after | Clearance passes before → after | Completed returns after |
| --- | ---: | ---: | ---: | ---: |
| Slower rival | 8.558 → 0 | 0 s | 0 → 1 | 0 |
| Defensive rival | 0 → 0 | 0.517 s | 1 → 1 | 0 |
| Smaller pace advantage | 1.342 → 0 | 1.325 s | 0 → 0 | 0 |

All before runs have zero road-envelope departure; all runs have zero stall.
The candidate's target lane rate is bounded to 2.5 m/s, but that does not prove
bounded physical lateral motion. The slower case enters ABORT before RETURN;
all three remain in RETURN at the observation cutoff. The fixture verifies
braking and turning occur in candidate runs, not just a straight-line pass.

Controller cost is emitted with each run; typical standalone measurements here
are roughly 0.007–0.02 ms/control. Host load changes timing, so rerun matched
measurements rather than treating these as a stable performance specification.

## Diagnosis and next experiment

The lane-rate limiter follows an absolute lane target while the reference lane
moves through a corner; RETURN can lag without converging. Its point follower
uses the original reference's speed while taking a different corner radius.
The measured departures show why bounding a target to road width is not enough.
These are candidate explanations from the implementation and telemetry, not a
completed causal ablation.

Next: design a short trajectory corridor including rotated vehicle footprint,
reference-relative merge progression, and speed limits for the actual candidate
curvature. Keep the chosen side while alongside; if the corridor closes, yield
longitudinally before merging. Add late rival movement, no-space, and successful
abort-to-FOLLOW physical cases; extend the observation through a settled return
with a finite timeout. Do not “fix” this by enlarging lane tolerances, teleporting,
adding grip, or weakening contact/road-envelope criteria.

The policy unit tests establish command-level side commitment, rate limit,
no launch into a corner/narrow gap, abort yielding and interrupted return. They
are not proof of physical safety. Human pair driving and browser performance
are pending. No full field, other circuit, explicit line, pit or lapped-car
rollout is authorized by these results. Issue #153 remains open.
