# Issue #153 — defensive racecraft candidate

Status: isolated human-review candidate; normal race/TT/ghost unchanged.
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
There is no automatic script driving the human in the lab: reproduce the
situations using your own inputs. The 45 m/s error start is an initial pose,
not a speed restriction on the human. No normal race enablement occurs.

Next: human evaluation against the Issue's experience criteria. Adjust the
judgment and control if defence remains unintuitive. Only after that, expand
preparation-distance/trajectory cases, narrowing during overlap, 8 cars, other
circuits and explicit lines, pit/lapped traffic. Issue remains open; do not
merge the experiment as gameplay rollout or close it from passing CI alone.
