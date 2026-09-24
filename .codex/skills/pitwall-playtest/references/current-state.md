# Current playtest state — 2026-09-24

This is a handoff snapshot, not a permanent balance specification. Prefer fresh measurements when available.

## Latest manual observations

Pitwall GP currently has a strong human/reference baseline:

- PLAYER PB observed: about **22.975 s**.
- Reference ghost replay observed: about **23.0 s**.
- Race CPU best laps in the latest screenshot remained roughly:
  - ORBIT 25.833
  - APEX 25.867
  - ZEN 25.925
  - VOLT 26.433
  - KITE 26.675
  - NOVA 26.700
  - RIFT 27.533

This strongly suggests the stored line itself is fast enough and race CPUs are still losing too much in execution.

Recent screenshots have also shown:
- a race CPU stalled at 0 km/h while target speed remained >130 km/h and profile brake stayed at 1.0;
- race CPUs with very large path/lane errors while the reference ghost stayed close to the PLAYER line;
- a visible start/finish seam/chord in the green PLAYER-line visualization;
- prior regressions in lap/sector counting and pit entry after projection changes.

## Current CI state at handoff

The branch is currently **not green**.

Recent failures include:
- CPU pace-assist expectation mismatches;
- positive AXF case unexpectedly braking;
- demonstrated AXF brake-phase mismatch;
- modest Q5 path miss reducing target speed too much;
- REFERENCE GHOST replay materially slower than demonstrated;
- low-speed recovery test not reproducing the intended brake-profile condition.

Do not paper over these failures. Determine which are real regressions and which assertions genuinely need to change because of an intentional product change.

## Product intent

The owner wants the game harder. A small stable CPU advantage is acceptable. Soft CPU cars may receive enough grip advantage to follow a very fast PLAYER line closely.

However:
- no player-position rubber-banding;
- no race-CPU cheats on REFERENCE GHOST;
- do not trade coherent driving for raw speed multipliers;
- remove controller/path-following losses before adding more pace.
