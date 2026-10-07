# Issue #153 — first pair passing experiment

Status: first candidate rejected; second candidate passes four limited physical
pair fixtures. Both remain isolated research, with no gameplay rollout.
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

## Second candidate: reference-relative return and curvature preview

`CorridorPassing` is a separate successor; the rejected `PairPassing` and its
12-second counterexamples remain intact. `PairPassingHarness` runs all three
controllers under the same conditions. The successor is still test-only, with
no production import or game menu entry.

Changes: slew the **offset relative to the reference** at 2.5 m/s; sample the
shifted reference path for steering; constrain sampled lane centres to the road
margin; use five preview stations (15/30/60/90/120 m) for candidate curvature
and a backward braking allowance. A 40 m/s² lateral-budget parameter, 16 m/s²
braking allowance and 98% reference-speed cap are conservative experimental
calibration values, not a measured universal tyre/friction model. Grip is not
increased. The search cost is fixed; it does not enumerate the full road width.

RETURN checks 22 m clearance now and after three seconds of constant relative
speed, with the same gap sign. A catching rival retains its physically occupied
side rather than the side chosen before the crossing. The return completes only
when offset <0.25 m, actual line error <1 m and heading error <0.2 rad remain
aligned for 0.35 s. Timeout is ten seconds before abandoning an unresolved
attack, with a three-second retry cooldown. None of these use player standing.

### Matched 20-second measurements

The added late-move rival steers to lane -6 from seconds 2–5, then resumes AUTO.
All other controls are the original fixture's. Each successor run is repeated
and all physical metrics must agree exactly. The table uses the same 20 seconds
for before, original candidate and successor; do not compare it as though it
were the earlier 12-second table.

| Rival | Before contact / departure (s) | Original candidate contact / departure (s) | Successor contact / departure (s) | Successor outcome / settled return |
| --- | ---: | ---: | ---: | --- |
| Slower | 13.525 / 0 | 0.425 / 0 | 0 / 0 | Pass, 9.517 s |
| Defensive | 0 / 0 | 0 / 0.633 | 0 / 0 | Pass, 14.667 s |
| Smaller pace advantage | 1.592 / 0 | 0 / 1.325 | 0 / 0 | Abort, 12.892 s |
| Late move | 12.900 / 0.383 | 0 / 0 | 0 / 0 | Pass, 7.517 s |

All have zero stall time. The successor passes strict zero contact/departure/
stall assertions, one settled return before 18 seconds, and the expected
pass-or-abort outcome. The observation includes at least two seconds after the
settled return. The original defensive/equal candidates do eventually return
when observed for 20 seconds: the original finding was **not returned by 12 s**,
not proof of never returning. The original slower candidate contacts the rival
later in its unfinished return, supporting the need for the longer observation.

Typical successor cost in these runs is ~0.024–0.043 ms/control versus baseline
~0.008–0.015 ms; the extra preview has a measurable cost. A broad 5 ms regression
ceiling is not an FPS budget. Physical projected lane-rate peaks are ~15.7–22.0
m/s, comparable to some baseline corner runs but far above the 2.5 m/s *target
offset* slew. Therefore the target limit must not be described as a bound on
physical lateral motion or as proof of comfortable human racecraft.

### Remaining gate

This establishes only four deterministic Pitwall pair cases. The sampled road
margin is not a continuous swept-volume proof and the constant-relative-speed
return predictor cannot anticipate arbitrary human steering/braking. A future
narrowing corridor can still invalidate the fixed seven-metre reservation.
No-space/corner rejection, reference motion, catching-rival return hold and
settling requirements have command-level unit tests; physical narrow-road,
more starting speeds/gaps, aggressive changes during overlap and continuous
swept-body prediction remain open. Add those before enabling a human pair lab.
The game and REFERENCE GHOST remain unchanged; #153 stays open.
