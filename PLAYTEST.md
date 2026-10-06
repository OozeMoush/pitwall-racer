# Pitwall Racer — Playtest Gate

Deterministic regressions and autonomous playtest evidence should come before asking for human feel.

Human play remains the final judge for subjective fun, but lap counting, qualifying, grid launches, pit entry, CPU stalls, path errors, racing-line seams, penalties and pace regressions should be automated wherever practical.

Non-negotiable gameplay invariants:

- `src/simulation/` owns authoritative race truth; rendering/HUD must not become the source of physics or timing truth.
- Reproduce gameplay bugs with deterministic regressions/playtests whenever practical before fixing them.
- Do not weaken an existing test merely to make CI green. If intended behaviour changes, explain the new invariant before updating the assertion.
- REFERENCE GHOST is a calibration instrument: no race-CPU difficulty assists, traffic logic, rubber-banding or pit strategy.
- Race CPU may use a small stable performance advantage, but never player-position rubber-banding.
- Grand Prix track-limit warnings never delete the physical lap. Four wheels fully beyond the legal road is the warning condition; five warnings create the configured 5-second pit penalty. PLAYER racing-line eligibility is separate.

## Automated gate

Use the tiers according to feedback cost:

```bash
npm run test:fast      # normal edit loop
npm run test:playtest  # gameplay and short physical regressions
npm run test:long      # multi-lap / multi-circuit / endurance regressions
```

The tiers partition the suite by purpose and runtime; the authoritative final gate is still:

```bash
npm test
npm run build
```

Run `test:long` explicitly when changing PLAYER-line replay, the reference ghost, long-run CPU behaviour, multi-circuit physics or the machine reference. Do not weaken a guardrail merely because the current build misses it. If intended behaviour changed, explain the new invariant and then update the test.

Race performance: compare AUTO and PLAYER BEST with seven CPUs, including
legacy and dynamics-bearing explicit lines. `RacePerformance.test.ts` reports
controller and Rapier time independently after warm-up; its broad 50 ms ceiling
is a catastrophic CPU-regression guard, not an FPS measurement. Confirm actual
browser frame rate in a race as well as Time Trial. Geometry/cache changes must
retain editor revision invalidation and unchanged racing-line/ghost behavior.

## 1. Session flow

Verify all three entry paths:

- **TIME TRIAL** — empty-track hotlapping; returns to the setup menu and may update PLAYER BEST.
- **START WEEKEND** — one-shot qualifying followed by the Grand Prix.
- **SKIP QUALIFYING** — starts the Grand Prix from P8.

Check that qualifying order maps to the compact starting grid, every car launches cleanly, and the first start-line crossing begins Lap 1 timing.

## 2. First 30 seconds

- Can a new player keep the car roughly on the circuit with WASD?
- Does steering feel immediate at low speed but require real braking at high speed?
- Does going wide cost time without making recovery miserable?
- Is the compact grid close enough to feel like a race without causing wall snags or launch pile-ups?
- Can every race action be reached comfortably with the left hand?

If basic driving is frustrating, do not add more race systems. Fix handling first.

## 3. Racing another car

- Can the player deliberately place the car beside a CPU rival?
- Does contact cost time without visible buzzing or repeated positional snapping?
- Does following feel different from clean air?
- Do CPU cars actually leave the train and complete passes?
- Can the fastest CPUs punish a player mistake without player-position rubber-banding?

The desired emotion is **“I can try that move again”**, not “the collision model cheated me”.

## 4. Racing-line execution

Compare AUTO, PLAYER BEST and the isolated REFERENCE GHOST.

- Record a faster eligible lap with PLAYER BEST selected: verify persisted time/trace, live CPU target and update notice together. Also cover Time Trial/menu and qualifying/race activation; rejected or failed writes must preserve the old target and explain the outcome.
- Does PLAYER BEST remain smooth through start/finish with no closing chord?
- Does the REFERENCE GHOST reproduce a clean demonstrated line without race-CPU difficulty assists?
- Do clear-running CPUs stay near their selected line rather than accumulating persistent path error?
- Does normal kerb use avoid triggering an emergency recovery response?

Use fresh telemetry rather than preserving an old lap-time target as a permanent specification.

## 5. Tyres

Run one clean stint and one harder stint with repeated late braking, high-speed steering or wheel-to-wheel fighting.

- Does the harder-driven stint wear the tyre materially faster?
- Does Soft create obvious early pace while asking for an earlier stop?
- Does Hard sacrifice enough immediate grip to make its life advantage a real choice?
- Is late-life slide risk noticeable but recoverable?
- Does one continuous wall/car contact avoid re-applying damage every physics frame?

## 6. Strategy and pits

Try different compound sequences and both early and late stops.

- Did at least two approaches feel plausible before the result was known?
- Did traffic ever change the preferred pit timing?
- Did the two-compound obligation create a decision rather than paperwork?
- Does an undercut or overcut decision remain committed instead of reversing on the next controller tick?
- Can player and CPU cars enter, service and leave the physical pit lane reliably?
- Is the circuit's limiter readable (Compact 130 km/h, Standard/Long 80 km/h) without making an extra stop automatically hopeless?
- Measure total pit transit separately from net loss against the same entry-to-exit mainline section; report the control, tyre and traffic assumptions.
- Compare player and CPU costs, including approach and recovery when judging a race strategy. Shared service timers alone do not establish equal execution.
- CPU pit transit must follow its actual body pose; pinning a car before the box must prevent service completion. Exit must preserve physical velocity.
- All seven circuits must allow the controlled CPU to enter on the requested lap, rather than miss the gate and wait another lap.
- Pit-cost experiments must not silently change tyre pace or wear in the approximation. Strategy balance must be judged with the live physical race; `UNVALIDATED_APPROXIMATION` results are sensitivity experiments, not physical balance evidence.
- Compare nearby stop windows, both stop families and Compact/Standard formats. Every normal full-race plan must finish legally, enter on schedule and keep deep-cut samples below 3%; do not force a universal three-second tie.
- Compare clear, adaptive traffic and fixed late-stop controls. Healthy tyres should avoid a counterproductive early Medium-to-Hard change; worn tyres should show a physical benefit. A deliberately worn late control diagnoses the cliff and must not replace or weaken normal full-race guards.
- Matched stop/no-stop controls must start from the same pose, speed, driver and tyre before braking. Measure physical gates at exit and +200/+400/+600 m; include gate speeds rather than assuming recovery is complete at a fixed distance.
- Player capture must work for varied entry/late-merge positions, speeds and headings, with released pedals or held entry inputs. Once committed, AUTO PIT must complete real-body transit; a pinned player body before the box must never complete service.
- Unrequested, mainline, reverse/opposite-direction and missed-ramp poses must not trigger player capture.
- Scripted player approach tests must reach service and exit on all seven circuits. Entry-to-exit tests alone do not cover the entry state created by braking/merging from the road.

There should be no obvious “always choose this tyre and pit on this lap” answer.

## 7. Multi-circuit sanity

Run the automated multi-circuit checks after track changes. In human play, sample at least one fast layout and one technical/street layout in addition to Pitwall GP.

Pay particular attention to:

- projection jumps between nearby pieces of miniature track;
- barrier geometry on tight corners;
- launch/grid placement near start/finish;
- Baku Street's long straight and tight city sequence.

## 8. One-more-race test

At the finish, the most important question is simple:

> Do I want to press C and try a different tyre, pit lap, attack, CPU line or circuit?

If yes, the core loop is working. If no, diagnose **driving feel, battles, tyre feedback or decision quality** before adding realism.

## Current non-goals

Do not request realism for its own sake. Fuel strategy, full FIA stewarding, safety cars, rain, setup engineering and multiplayer remain deferred until the dry single-player race is consistently fun. Hybrid energy is also parked outside the current playable core.

## Rival strategy readability (#150)

Deterministic tests must cover matched samples/signs, no-data states, pit/out
lap filtering, invalid/recovery samples, nonfinite times, timing-line lapping
boundaries, opponent changes and physical phase notification deduplication,
expiry and restart. A failed/recovered player lap may still count in the Grand
Prix but must not supply clean pace evidence. Keep CPU future plans out of the
normal strategy panel (debug is a separate diagnostic).

Check the tower at desktop and smaller desktop sizes in a seven-CPU race:
AHEAD/BEHIND must identify classification neighbours, show actual compounds,
and distinguish a whole-lap deficit. Before enough clean matching laps, display
no-data rather than a fabricated number. At physical pit entry/service/exit,
check four-second short notices and no pile-up or centre warning overlap.
Read pace/sample laps while driving; check player stops and rival overtakes.
Measure AUTO and legacy/dynamics PLAYER controller/physics as usual; also
compare live browser frame rate and HUD cost. Unit timings do not certify FPS.
