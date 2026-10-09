# Issue #153 — defensive racecraft candidate

Status: opt-in normal-GP human-review candidate on PR #177; not merged to main.
The user requires evaluation in a normal race, rather than acceptance from the pair lab.
Built from fresh main `bbfafdb`, incorporating the #175 experiment as comparison
material without merging it to main. The Issue's 2026-10-09 agreement is the
experience specification; old automated success did not approve the experience.

## Decisions and mechanism

Freeze the chosen **reference-relative** corridor during an attack. Before
body overlap, detect actual/predicted defender movement into that corridor;
brake, abandon and create a longitudinal gap. Do not shift the corridor further
away to keep attacking and do not instantly pick the opposite side. Return with
predicted longitudinal clearance, physical alignment held for 0.35 s, then a
3 s cooldown before reconsidering. Reference steering may take over during the
last return stage only when the offset and present/predicted gap are clear;
FOLLOW still waits for physical settling.

Existing physical overlap reserves the occupied side even if the reference
line crosses it. Slow-error attacks prefer the outside of the approaching bend.
Both cars share the unchanged physical chassis/grip/power; no position-based
pace compensation or collision immunity. The passing candidate applies a
curvature/braking preview and conservative start-space checks. An approach
must have preparation distance (sampled heading over 60/120/180 m <0.12 rad),
room for the offset at fixed preview stations and actual pace difference.
A clear slowing-error attack may continue into a bend; this is **not** permission
to start from arbitrary mid-corner poses or proof of swept-body feasibility.

Exploration at progress 0.24/0.26 initially allowed a launch that did not settle
within 20 s. Do not extend the return timeout to hide that failure: final policy
rejects those starts via preparation-distance gating. Progress 0.20 has space
and passes outside through the bend. Future work may deliberately broaden this
envelope with trajectory evidence. Stopped-car behavior is inherited comparison
infrastructure, not the priority or a generalized stopped-field solution.

Rejected approaches and rationale are recorded in DESIGN: power-through closed
space removes meaningful defence; always-yield removes opportunity; immediate
side switching removes commitment; zero-contact promises for every squeeze
would require artificial behavior or disabled collisions.

## Physical evidence

All rows use colliding Rapier player + CPU bodies on Pitwall AUTO at 120 Hz,
equal Medium grip and +0.22 power. No race strategy/wear/dirty air/pit/recovery
assist is included. The selected rival actions are deterministic scripts, not
arbitrary keyboard behavior. Every new physical run is repeated exactly,
excluding wall time. Raw per-0.25 s traces, contact onset and matched old/new
controls are in `153-defensive-racecraft-metrics.json`.

| Scenario | Observation | Pass | Settled return | Contact / departure / stall |
| --- | ---: | ---: | ---: | --- |
| Early block, each side | 5 s | 0 | 2.033 / 2.050 s | 0 / 0 / 0 |
| Defender chooses opposite side | 20 s | 1 | 7.733 s | 0 / 0 / 0 |
| Slowing mistake before corner, p=0.20 | 20 s | 1, outside | 10.325 s | 0 / 0 / 0 |
| Existing corner overlap, CPU ±7 m | 12 s | 1 each | 6.850 / 6.792 s | 0 / 0 / 0 |
| Marginal available pace | 20 s | 0, abandon | 12.900 s | 0 / 0 / 0 |
| Insufficient approach, p=0.24/0.26/0.28 | 20 s | no launch | n/a | 0 / 0 / 0 |
| Unsqueezed matched control | 20 s | 1 | 9.575 s | 0 / 0 / 0 |
| Human squeeze after real overlap | 20 s | 1 | 14.150 s | 0.492 s / 0 / 0 |

Old corridor policy reports no abandonment in the matched 5 s early-defence
cases. The new policy commands braking before overlap, becomes slower than the
rival within the next 0.25 s observation, and settles with >5 m additional gap.
That gap can close afterward; it is not a permanent lockout of renewed attacks.
The old corridor does not finish its p=0.20 slowing-error maneuver within the
matched 20 s observation; the new candidate passes outside and settles.

Established left/right corner overlap lasts 1.175 / 1.700 s with >5.5 m sampled
lateral separation throughout ALONGSIDE. The outside slowing-error case has
0.967 s measured corner overlap (centre gap <9.3 m, ego yaw >0.15 rad/s). The late squeeze begins at 5.008 s, gap 8.194 m
(after longitudinal body overlap); actual manifold contact follows. This labels
the specified scripted cause, not a general steward/fault classifier.

Wall-time costs are recorded separately; broad 5 ms regression guard applies.
Target offset slew is 2.5 m/s, **not actual vehicle lateral speed**. The physical
lane-coordinate derivative includes curve/projection effects and reaches about
18 m/s after return under existing reference following. No bounded actual
lateral motion, browser FPS, human comfort or all-corner guarantee is claimed.
Road envelope/contact metrics use discrete 120 Hz samples, not continuous sweep.

## Try and resume

Checkout `feat/153-defensive-racecraft`, `npm install`, `npm run dev`, open
`http://localhost:5175/passing-lab.html`. The default is the new candidate.
Select old/new and one of: straight defence; slowing error before a corner;
existing corner overlap. Changing selection resets and pauses the pair.
WASD drive, P pauses, R resets; blue human/yellow CPU, yellow dot target.
The lab remains a supplemental diagnostic. There is no automatic script driving the human in the lab: reproduce the
situations using your own inputs. The 45 m/s error start is an initial pose,
not a speed restriction on the human.

## Normal GP trial (2026-10-10 JST)

Open `http://localhost:5175/` on the PR branch. Choose Pitwall GP, AUTO,
QUICK and **CPU攻防を試す**, then SKIP QUALIFYING · P8 or START WEEKEND.
The checkbox defaults on for this review branch; uncheck for the established
normal-race controller. Other circuits and PLAYER/EDITOR lines disable it;
Time Trial never enables it. Retry retains the session choice. Summary JSON
records `context.experimentalPassing` so comparisons can identify the policy.

`RacePassingController` adapts the candidate to all seven physical CPU cars.
Neighbours are measured by circular physical progress, including lapped cars.
A committed opponent stays locked until return; third cars reserve passing and
merge corridors. A departed or pitting opponent becomes a far-clear virtual
reference until return, rather than causing an abrupt opponent switch.

Grid launch below 25 m/s uses the established control: entering the pair's
existing-overlap state at grid-creep speed caused a field-wide braking deadlock.
Yielding now slows a trailing attacker, not a car already clear ahead. The first
full-field run exposed that deadlock; it is retained as the reason for the
low-speed handoff and progress regression. Pit approach/transit, recovery,
finished cars and reset clear passing state. Player pit bodies and active CPU
pit bodies are excluded from on-track attack selection. Chassis, CPU driver
performance/power, tyres/wear, aero, contacts and physical pit truth stay in the
existing race runtime; the pair lab's equal-power setup is not a new GP balance.

Automated normal-runtime evidence is in `RacePassingPhysics.test.ts` and the
`153-normal-gp-metrics.json`. Two scripted 20 s exchanges repeat exactly (excluding
wall time), have zero contact and rotated-body road departure, and show an open
pass versus abandonment of an early block. The seven-CPU grid check uses real
wear/traffic/occupancy/control at 120 Hz for 70 s, requires all CPUs to complete
at least two laps and keep moving. This is a liveness regression, **not** proof
of contact-free field racing: both old and new fields exhibit departures under
existing race hardware. A separate physical pit entry/service/rejoin test runs
with the trial enabled. Tests do not establish browser FPS or human feel.

Next: human evaluation in the normal GP. Check early blocking, slowing mistakes,
corner overlap and renewed attacks amid the actual field, including pit windows.
Other circuits/explicit lines and full-race traffic safety remain open. Keep the
Issue and PR open; passing CI does not authorize a gameplay rollout or closure.
