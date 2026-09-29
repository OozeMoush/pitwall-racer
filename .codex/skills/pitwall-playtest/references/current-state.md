# Current playtest state — 2026-09-29

This is a handoff snapshot, not a permanent balance specification. Prefer fresh measurements when available.

## Baseline

The current integration work has been merged to `main`.

Verification at the handoff:

- `npm test` — all tests passing
- `npm run build` — passing
- working tree was clean after syncing `main`

Do not assume an old failure is still present. Reproduce it against the current branch first.

## Current playable shape

- race-scale Pitwall GP 2.0 plus six selectable legacy miniature circuits, including Baku Street;
- SHORT / STANDARD / LONG Grand Prix duration presets with per-circuit derived lap counts; Pitwall STANDARD is currently 18 laps / 27 reference minutes;
- standalone Time Trial that returns to the setup menu;
- one-shot qualifying or optional P8 qualifying skip;
- AUTO / PLAYER BEST CPU racing-line selection;
- compact two-column starting grid near the timing line;
- physical 80 km/h pit lane and separate pit boxes;
- duration-scale tyre strategy with competitive one-stop and two-stop CPU families; Pitwall net pit loss is ~18.1 s;
- REFERENCE GHOST remains the unassisted calibration baseline.

## Race-scale checkpoint

Main CI #849 is green after the #85 scale/strategy pass:

- Pitwall GP length: ~8069 m;
- dynamic field estimate: ~89.4 s/lap;
- machine reference: 82.061 s;
- STANDARD strategy benchmark: 18 laps, ~27.95 min fastest legal race;
- fastest one-stop and two-stop benchmarks are separated by ~0.05 s;
- live CPU plans are constrained to the competitive strategy envelope.

## Recently closed regressions

The current tests cover fixes for:

- P2 grid-slot wall sticking independent of driver identity;
- start-line / Lap 1 timing;
- PLAYER-line start/finish seam handling;
- explicit-line replay and kerb tracking;
- physical pit-lane rendering orientation;
- committed undercut / overcut strategy not flipping on the next tick;
- Baku Street geometry continuity;
- compact-grid physical launch behaviour.

These are regression areas, not proof that future changes cannot break them.

## Pace guidance

Historical screenshots previously showed a strong PLAYER / reference-ghost lap and slower race CPUs. That motivated the current racing-line and CPU execution work, but those old lap times are **not** a permanent acceptance target.

When pace is questioned:

1. capture fresh PLAYER / REFERENCE GHOST / race-CPU evidence on the same build;
2. separate line-data problems from controller execution loss;
3. fix path/brake/phase errors before adding raw speed;
4. stable CPU-only grip/power advantage is acceptable;
5. player-position rubber-banding is not;
6. never apply race-CPU difficulty assists to REFERENCE GHOST.

## Product intent

The game should be challenging enough that a good CPU can punish mistakes while remaining physically coherent and debuggable.

Priorities remain:

- coherent driving before raw speed;
- meaningful tyre and pit decisions;
- reliable timing / track limits / pits;
- compact, readable wheel-to-wheel racing;
- automation for objective regressions, human play for subjective feel.
