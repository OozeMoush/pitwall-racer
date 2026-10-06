# Pitwall Racer — Current Project State

> Canonical current-state snapshot for humans, ChatGPT Project and Work sessions.
>
> This file is intentionally concise. Durable product decisions belong in `DESIGN.md`; detailed implementation history belongs in Issues and PRs.

## Verified baseline

Last updated: **2026-10-06 JST**

- default branch: `main`
- previous verified main: `6172c31c3e1184f117b66aaea59c6974673eb66c`, CI **#904 — success**
- current code change: **Issue #147 CPU race performance / cached geometry**; use its implementation PR and current Actions for the merged SHA / CI status
- repository visibility: **public**
- development server: **Vite port 5175, strictPort**
- branch policy: protected `main`, PR required, squash-only, fast/playtest/long checks required, linear history, no force-push/delete
- merged head branches are deleted automatically

Before relying on this snapshot, compare current `main` and recent CI. Documentation-only commits do not require a baseline bump; update this file when code, architecture, project direction or verification assumptions move materially.

## Product direction

Pitwall Racer is a **top-down Formula-style racing game first**. Driving feel, CPU racecraft, tyre behaviour and pit decisions matter more than simulation complexity.

Current product rules:

- physical single-player racing remains the core;
- eight-car field: player + seven physical CPU cars;
- no player-position rubber-banding;
- REFERENCE GHOST stays unassisted and is used as a calibration instrument;
- dry races require two tyre compounds;
- hybrid energy management remains deferred until the dry core race is consistently fun;
- physical circuit scale and race duration are separate axes.

See `DESIGN.md` for the durable rationale.

## Current playable shape

The current main branch includes:

- fixed elevated top-down Three.js presentation;
- Rapier 2D physical player and CPU field;
- Soft / Medium / Hard tyres with wear and performance effects;
- physical player and AI pit flow;
- standalone Time Trial;
- one-shot qualifying or P8 qualifying skip;
- Grand Prix with SHORT / STANDARD / LONG duration presets;
- AUTO and PLAYER BEST CPU racing-line sources;
- five-light reaction start;
- lap / sector / history / standings HUD;
- Issue #150 implementation branch: classification rival pace / physical pit feedback;
  visual readability and browser performance still require verification before merge;
- #151 implementation: bounded version-1 race summary and post-race observation
  review with rival selection, pit history, retry buttons and JSON export;
  human readability/FPS validation is pending in the implementation PR;
- tow and dirty air;
- track limits and race penalties;
- multiple selectable circuits;
- interactive circuit editor with:
  - closed-loop geometry editing,
  - local road width,
  - start/finish and sectors,
  - grid authoring,
  - pit entry / editable pit route / pit exit,
  - authored EDITOR reference line,
  - deterministic JSON import/export.

## Physical circuit scale decision

Issue #111 established **multiple physical circuit formats**:

- **Compact** — reference: Serra Circuit, ~23.119 s/lap;
- **Standard** — Baku Street retains its authored long-straight format;
- **Long** — available for deliberately large authored layouts.

Race duration remains independent. A STANDARD event targets roughly 27 minutes on either Compact or Standard circuits.

Current fictional-circuit machine references range from about 20 to 34 seconds.
Pitwall GP is 2.90 km / ~33.5 s, giving 48 laps for the ~27-minute STANDARD event.
Serra remains 1.85 km / ~23.1 s / 70 laps; Baku retains its Standard geometry and
90-second event-planning reference / 18 laps. Machine reference and actual human
race duration are not interchangeable.

Issue #137 removes artificial 2.8–3.2 km straight extensions from five fictional
circuits. Pitwall's compact corner spacing is enlarged 1.4× from the smallest
footprint to keep projection and physical driving robust. Compact service timers are shared by player and CPU. Harbor pit entry moves
to 0.75 on its straight to avoid a folded route at start/finish. Strategy
harness tyre effects no longer follow pit cost. Controlled physical pit tests
now share actual braking/steering/acceleration and spatial pit progress. CPU
transit no longer follows a clock or teleports to an exit-speed pose. All seven
controlled routes enter on the requested lap and complete service/exit. Compact
entry-to-exit player loss is about 9.75–11.15 s vs CPU 7.08–10.97 s, using each
control's own mainline baseline; approach/recovery are excluded from this table.
Matched controls now include approach and exit +200/+400/+600 m, with each
car's own no-stop baseline. A scripted Harbor player approach exposed a
pre-service stall; shared pit-route bend braking fixes that condition. Measured
+600 m Compact losses are about 10.34–15.08 s CPU / 12.26–14.81 s instrumented
player, with residual recovery on some routes. Live physical comparisons now
cover nearby Compact stop windows, Standard Baku and healthy/worn traffic
controls. M-H@18 is 5.12 s behind the tested best two-stop on Pitwall; the tested
Baku one-stop wins by 28.77 s. CPU undercuts require the existing late-wear region
instead of traffic alone. The unused strategy approximation is explicitly
unvalidated and no longer supplies the Compact near-tie balance gate. Broader
traffic and human feedback remain open; the fixed-speed estimate is not a
measured player pit loss. See DESIGN for controls, per-circuit values and limits.

Player entry now accepts a bounded late merge on the actual pit ribbon. After
physical commitment, AUTO PIT owns the controls through service and exit;
released pedals and held entry steering cannot strand the car. Capture keeps
request/side/direction checks; real-body movement and spatial service progress
remain authoritative. See DESIGN and PLAYTEST for the tested entry envelope.

## Recent structural work

Recently completed project-level work:

- #109 — geometry-revision invalidation for derived circuit data;
- #110 — dedicated circuit editor and authored reference/pit infrastructure;
- #111 — Compact / Standard / Long physical scale model;
- #132 — repository workflow for public development;
- #133 — fixed Vite development port 5175.

The old `feat/machine-optimal-reference` experiment has been preserved as:

`archive/machine-optimal-reference-2026-09`

It is archival evidence, not active mainline architecture.

## Current work discovery

Issue **#137** is closed at the user-approved strategy/layout checkpoint.
Issue **#147** is closed after PR #148 and user-confirmed race performance improvement.
Active gameplay: **Issue #143**,
player pit capture implemented and awaiting human confirmation; **Issue #144**,
PLAYER BEST updates reaching the CPU.
Circuit editor improvements: **Issue #138**, separate work.
Project-operations migration: **Issue #134**, external configuration / follow-up verification.

**GitHub Issues are the authoritative work queue.**

Do not infer active work from old branches, chat history or memory.

At session start:

1. read the open Issues;
2. read the relevant Issue body and latest comments;
3. inspect linked/open PRs;
4. only create a new Issue when substantial work has no existing work item.

One Issue may be implemented by multiple coherent PRs. The Issue closes only when its acceptance criteria are complete.

## Immediate risks to keep watching

These are ongoing design/engineering risks rather than necessarily open bugs:

1. Driving must stay readable and satisfying as speed increases.
2. CPU difficulty must come from coherent driving, not hidden position-based compensation.
3. PLAYER BEST / AUTO / EDITOR lines must remain physically executable across track changes.
4. Compact circuits can create traffic/lapping saturation; solve this per circuit or event rather than padding layouts with dead straights.
5. Tyre/pit balance must remain meaningful across different physical circuit scales.
6. Circuit editor metadata and generated runtime data must stay geometry-revision safe.
7. Automated playtests protect objective behaviour but must not replace subjective human feel.

## Where to look next

- product/design intent: `DESIGN.md`
- project operating model: `docs/PROJECT_OPERATIONS.md`
- ChatGPT Project / Work setup: `docs/CHATGPT_PROJECT_SETUP.md`
- gameplay validation: `PLAYTEST.md`
- active work: GitHub Issues
- implementation history: merged PRs

If this file conflicts with code/tests or a newer merged Issue/PR, the newer repository evidence wins and this snapshot must be updated.
