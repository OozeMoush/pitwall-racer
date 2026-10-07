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
## Post-race review (#151)

Deterministic gates: 1 Hz position/gap sampling, exact physical pit changes,
missing intervals, whole-lap vs line-crossing offsets, counted vs unknown-clean
laps, idempotent finish, player DSQ/pending penalties and unfinished CPU cutoff.
Exercise long-session sample/event/lap bounds, snapshot ownership, independent
restart, changed line fingerprints and cached review rendering. Retain the
physical GP pit regression: exported phases must match actual entry/service/
exit and actual fitted compound. No future CPU plan belongs in the summary.

Human checks: finish a race, scroll the review without resets, select rivals,
read position/gap traces and both pit histories. Confirm missing/lapped gaps do
not join into an apparent measured time delta. Observe before/after both pit
rejoins; do not attribute all delta to strategy. Download JSON and verify setup,
line changes, timestamps and cutoff states. Retry identical setup and a changed
starting tyre: grid/initial runtime line restore, saved PLAYER BEST survives,
recording starts empty. Check finish on a shorter desktop and keyboard focus.
Measure seven-CPU browser FPS; no frame-rate claim follows from unit tests.
### Issue #152: audio feedback foundation

- Brake hard near an opponent without contact: no impact thump. Hit a car or barrier: one thump per contact episode; sustained rubbing stays quiet.
- P / ESC pauses both driving and sound. Adjust VOLUME / MUTE in the pause screen; zero mutes. Resume and restart retain the selected session volume without replaying old start/contact sounds.
- Finish and qualifying results hush continuous driving audio. Moving from qualifying to the race must not leave the old engine audible.
- With seven CPUs, repeat contacts, pause/resume and qualifying retries; check audible comfort, frame time and Web Audio resources. Sound balance and these browser checks require human confirmation; unit tests/build do not replace them.
- This slice uses only existing procedural oscillators/noise. Directional rival audio, position/pit/PB cues and richer finish presentation remain separate #152 work.

### Integrated human feedback: #150 / #160

- Rival pace now appears in the existing tower as Δ PACE, in seconds/lap: player minus rival. Negative/green is gaining, positive/red is losing, zero is neutral. This is recent matched clean-lap pace, not the instantaneous GAP column. Pit/lap-deficit/no-data rows show a dash; actual CPU pit phases appear as IN/BOX/OUT in the driver row. Separate AHEAD/BEHIND cards are removed.
- Check this column at narrow viewport widths, without extra tower rows.
- Scroll up/down over the driving canvas in qualifying and race: verify bounded zoom and retained player follow. Resize and restart; verify UI/result panels still scroll normally.

Human feedback correction: Δ PACE uses the latest jointly completed lap, including start, pit, out and invalid laps; only missing/nonfinite/nonpositive times are unavailable. The tower explicitly allocates seven desktop columns (P, TYRES, DRIVER, GAP, LAST, Δ PACE, BEST); narrow screens hide LAST and allocate six columns, retaining pace and BEST horizontally.

## Review hierarchy — #162

Verify signed measured gaps, default/fallback rival, null/lapped trace breaks,
exact-time pit placement and both drivers' markers. Compound bests must include
early retained stints beyond the visible last-12 table, exclude mixed/pit laps,
show unused tyres as dashes and disclose truncation. Do not assert clean driving.
Check desktop and 390px width, touch tap, pointer hover and keyboard range,
closed details on first finish, detail scrolling, rival selection, focus,
static refresh stability, JSON download and same/different-tyre retry. Real
race/FPS and subjective readability remain human gates beyond fixture rendering.

## QUICK format — #161

Automated: all-circuit derived lap counts / legal CPU single-stop windows and
adaptive physical completion on Compact Pitwall and Standard Baku. Full suite
must retain normal-format pit/tyre regressions. Human: select QUICK, qualify or
skip, finish legally using two compounds, retry with same/different tyre; check
approximate duration (qualifying excluded), seven-CPU FPS and whether one physical
stop leaves enough meaningful racing. No accelerated wear is expected.


## Fullscreen review / stranded pit entry — #166 / #167

Automated: one visit elapsed-time pairing (including missing, incomplete and
ambiguous evidence); only entry markers; real Rapier wall obstruction in committed
pit transit; C at unchanged pit coordinate and subsequent physical service after
removing the obstruction; stationary wall contact before capture without implicit
pit admission; existing all-track pit capture and pinned-body no-service checks.
Human: fullscreen at 1920×1080 and ultrawide, then 390px width; ensure bounded
review/graph, visible retry, scrolling and pointer cursor alignment. Reproduce
actual entry-wall impacts on the user's circuit, wait for STRANDED, press C and
complete the stop. No browser visual, real race or FPS verification is claimed by
the automated fixtures. Recovery is explicit C, not an automatic teleport.


## CPU pit wall stalls — #169

CPU clarification supersedes the actor assumption in #167. Automated Rapier
fixtures cover approach and committed transit stopped by a cross-lane wall:
actual reverse displacement, no timer-driven service, then physical completion
after clearing the obstruction. A persistent side wall remains in place while a
CPU initially facing into it backs away, aligns with the pit route, completes
service and rejoins. Retain ordinary road recovery, all-circuit physical pit
checks and pinned-body no-service checks. A low-target transit request can
trigger recovery; intentional service dwell cannot. Human follow-up: user's
specific circuit, entry impact and traffic configuration, plus real race FPS.


## Driver history, Time Trial slice — #155

Automated: chronological clean/slower/invalid attempts; actual condition-scoped
PB changes with prior times; geometry/rules/tyre/wear/temperature separation;
legacy TT/PLAYER BEST isolation; duplicate finish suppression; incomplete attempts;
accumulated invalid reasons; bounded attempts/anchors/updates with omission counts;
corrupt/future schema preservation; read/write failure without claiming an unsaved
history; last-20 denominator including invalid laps; clean-only population spread,
minimum three and mean/count disclosure; no silent slow-outlier removal; escaping
stored identifiers and empty states. Session tests exercise actual completeLap
and invalid-lap persistence hooks; qualifying does not write TT history.

Human pending: enter TT, complete clean and warned/contact/recovery laps, return
to menu → ドライバー記録, reload and inspect persisted records; select track and
condition, inspect dated PB curve and latest rows, export JSON, return with setup
selection preserved. Check 390px/desktop/fullscreen scrolling, select keyboard
focus, readability and no obstruction of the normal session selector. Actual
browser rendering/audio/FPS are not claimed by fixture tests. TT-only collection
must remain absent from seven-CPU race ticks. Race-session history, context and
race/TT separation remain subsequent #155 work; do not close the full Issue here.
